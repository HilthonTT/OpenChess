import {
  Prisma,
  type Puzzle as PuzzleRow,
  type PuzzleRushMode,
  type PuzzleRushRun,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  solutionSan,
  startPuzzle,
  submitPuzzleMove,
  type PuzzleSession,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { satisfiedRushCodes } from "../game/achievements";
import { levelFor } from "../game/rules";
import { throwProblem } from "../lib/problem-details";
import { unlockAchievements, type Unlocked } from "../player/unlocks";
import { rushReward, RUSH_MISS_LIMIT, rushRatingTarget } from "./rush-rules";
import { toEnginePuzzle, toPuzzleView, type PuzzleView } from "./rules";

/**
 * Puzzle Rush: as many puzzles as you can solve before the clock or your third
 * mistake stops you.
 *
 * It is the same solving protocol the rated queue uses — a round trip per move,
 * the line never leaving the server — with three deliberate differences.
 *
 * The run is *server-timed*. `endsAt` is written when the run starts and every
 * submission is checked against it, because a score that a client's own timer
 * could vouch for is not a score.
 *
 * It is *off the ladder*. A run writes no `PuzzleAttempt` rows and moves no
 * puzzle rating: rushing rewards speed and nerve, rating rewards accuracy, and
 * a player should be able to do one without wrecking the other. It also means a
 * rush never eats into the "puzzles I have not been scored on" pool that the
 * rated queue serves from — you can rush the same puzzles all week and still
 * meet them fresh when it counts.
 *
 * And it pays *once, at the end*, on the run's own `rewardsGranted` flag, the
 * same guard `Game` uses. Paying per solve would make a run a coin faucet you
 * could tap by starting one and abandoning it at nine.
 */

const SERIALIZATION_FAILURE = "P2034";

/** How long each timed mode gives you. Survival has no clock at all. */
export const RUSH_DURATION_MS: Record<PuzzleRushMode, number | null> = {
  THREE_MINUTE: 3 * 60_000,
  FIVE_MINUTE: 5 * 60_000,
  SURVIVAL: null,
};

export const RUSH_MODES: PuzzleRushMode[] = [
  "THREE_MINUTE",
  "FIVE_MINUTE",
  "SURVIVAL",
];

export type RushRewardView = {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  unlocked: Unlocked[];
};

export type RushRunView = {
  id: string;
  mode: PuzzleRushMode;
  solved: number;
  missed: number;
  /** How many mistakes are left before the run ends. */
  livesLeft: number;
  /** The puzzle to solve now, or null once the run is over. */
  puzzle: PuzzleView | null;
  /** When the clock stops it, or null on a survival run. */
  endsAt: string | null;
  endedAt: string | null;
  over: boolean;
  /** Present only on the response that ends the run. */
  rewards: RushRewardView | null;
  /** Your best score at this mode, including this run. */
  best: number;
};

export type RushMoveView = RushRunView & {
  /** What the last move did. Null on a run that was already over. */
  outcome: "continue" | "solved" | "wrong" | null;
  /** The reply the line forces, when the puzzle is not finished. UCI. */
  reply: string | null;
  /** Revealed once the puzzle is done with, right or wrong. */
  solution: string[] | null;
};

function livesLeft(missed: number): number {
  return Math.max(0, RUSH_MISS_LIMIT - missed);
}

/** Whether the clock has run out on `run`, as of now. */
function outOfTime(run: PuzzleRushRun, now = Date.now()): boolean {
  return run.endsAt !== null && now >= run.endsAt.getTime();
}

function isOver(run: PuzzleRushRun, now = Date.now()): boolean {
  return (
    run.endedAt !== null || run.missed >= RUSH_MISS_LIMIT || outOfTime(run, now)
  );
}

/**
 * Serve the next puzzle for a run.
 *
 * The target rating climbs with the score, so a run opens with something a
 * beginner can take and ends somewhere they cannot — which is what makes a
 * score a measurement rather than a stopwatch reading. `servedPuzzleIds` keeps
 * a run from asking the same question twice; across runs there is no such
 * constraint, and there should not be, since a rush is practice.
 */
async function pickRushPuzzle(
  solved: number,
  exclude: string[],
): Promise<PuzzleRow | null> {
  const target = rushRatingTarget(solved);
  const notSeen = exclude.length > 0 ? { id: { notIn: exclude } } : {};

  const above = await db.puzzle.findFirst({
    where: { rating: { gte: target }, ...notSeen },
    orderBy: { rating: "asc" },
  });

  if (above) {
    return above;
  }

  // Past the top of the corpus: take the hardest thing left rather than
  // stopping a run that was going well.
  return db.puzzle.findFirst({
    where: { rating: { lt: target }, ...notSeen },
    orderBy: { rating: "desc" },
  });
}

/** The best score this player has ever posted at `mode`. */
async function bestScore(
  userId: string,
  mode: PuzzleRushMode,
): Promise<number> {
  const best = await db.puzzleRushRun.findFirst({
    where: { userId, mode },
    orderBy: { solved: "desc" },
    select: { solved: true },
  });

  return best?.solved ?? 0;
}

async function view(
  run: PuzzleRushRun,
  puzzle: PuzzleRow | null,
  rewards: RushRewardView | null = null,
): Promise<RushRunView> {
  const over = isOver(run);

  return {
    id: run.id,
    mode: run.mode,
    solved: run.solved,
    missed: run.missed,
    livesLeft: livesLeft(run.missed),
    // A finished run has nothing to solve, whatever is still pinned to it.
    puzzle:
      over || !puzzle
        ? null
        : toPuzzleView(puzzle, { attempted: false, daily: false }),
    endsAt: run.endsAt?.toISOString() ?? null,
    endedAt: run.endedAt?.toISOString() ?? null,
    over,
    rewards,
    best: await bestScore(run.userId, run.mode),
  };
}

/** Start a run. Any run still open — at any mode — is settled out first. */
export async function startRush(input: {
  user: User;
  mode: PuzzleRushMode;
}): Promise<RushRunView> {
  // An abandoned run is finished rather than left to linger. Without this a
  // player could keep several open and cherry-pick the one that went best —
  // and a survival run, having no clock, would otherwise never close at all.
  //
  // Settled through `finishRun` rather than closed with a bare `updateMany`.
  // Stamping `endedAt` on its own strands the run permanently unpaid: every
  // path that pays — `getRush`, `endRush`, `playRushMoves` — settles only a run
  // whose `endedAt` is still null, so once it is set nothing will ever grant the
  // rewards. The score itself is not stranded with them, since `bestScore` and
  // `rushBests` both count an ended run, which is what made the loss silent —
  // a twenty-solve run walked away from kept its place on the board and paid
  // nothing. Abandoning a run is the same act as ending it, so it pays the same.
  const open = await db.puzzleRushRun.findMany({
    where: { userId: input.user.id, endedAt: null },
  });

  for (const abandoned of open) {
    await finishRun(input.user, abandoned);
  }

  const first = await pickRushPuzzle(0, []);

  if (!first) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "There are no puzzles to rush. Import some first.",
    );
  }

  const duration = RUSH_DURATION_MS[input.mode];

  const run = await db.puzzleRushRun.create({
    data: {
      userId: input.user.id,
      mode: input.mode,
      currentPuzzleId: first.id,
      servedPuzzleIds: [first.id],
      endsAt: duration === null ? null : new Date(Date.now() + duration),
    },
  });

  return view(run, first);
}

/** A run by id, refusing one that is not this player's. */
async function loadRun(user: User, runId: string): Promise<PuzzleRushRun> {
  const run = await db.puzzleRushRun.findUnique({ where: { id: runId } });

  if (!run || run.userId !== user.id) {
    // Not "forbidden": whether a run exists is not something a stranger gets
    // to learn by asking, which is the same line the game service draws.
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such run");
  }

  return run;
}

export async function getRush(user: User, runId: string): Promise<RushRunView> {
  const run = await loadRun(user, runId);

  // A run whose clock ran out while nobody was submitting is settled on the
  // next read, so an abandoned tab does not leave a row open forever.
  if (isOver(run) && run.endedAt === null) {
    return finishRun(user, run);
  }

  const puzzle = run.currentPuzzleId
    ? await db.puzzle.findUnique({ where: { id: run.currentPuzzleId } })
    : null;

  return view(run, puzzle);
}

/**
 * Settle a run: stamp it finished, and pay for it exactly once.
 *
 * `rewardsGranted` is claimed by a conditional update, so two requests racing
 * to end the same run — the clock expiring on a read while a submission is in
 * flight — cannot both pay. The loser sees the run already settled and reports
 * what the winner banked.
 */
async function finishRun(user: User, run: PuzzleRushRun): Promise<RushRunView> {
  const reward = rushReward(run.solved, run.mode);

  try {
    const settled = await db.$transaction(
      async (tx) => {
        // The claim. `rewardsGranted: false` in the filter is what makes this
        // exactly-once; a second attempt updates no rows and throws.
        const claimed = await tx.puzzleRushRun.updateMany({
          where: { id: run.id, rewardsGranted: false },
          data: {
            endedAt: run.endedAt ?? new Date(),
            currentPuzzleId: null,
            rewardsGranted: true,
            xpAwarded: reward.xp,
            coinsAwarded: reward.coins,
          },
        });

        if (claimed.count === 0) {
          return null;
        }

        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });

        const unlocked = await unlockAchievements(
          tx,
          user.id,
          satisfiedRushCodes(run.solved),
        );

        const xp =
          reward.xp + unlocked.reduce((sum, entry) => sum + entry.xpReward, 0);
        const coins =
          reward.coins +
          unlocked.reduce((sum, entry) => sum + entry.coinReward, 0);

        const experience = fresh.experience + xp;
        const levelAfter = levelFor(experience);
        const balance = fresh.coins + coins;

        if (coins > 0) {
          // No gameId, so the ledger's per-game unique index does not
          // constrain this row; the run's own `rewardsGranted` claim above is
          // what makes the payout exactly-once.
          await tx.coinTransaction.create({
            data: {
              userId: user.id,
              amount: coins,
              reason: "PUZZLE",
              balanceAfter: balance,
            },
          });
        }

        await tx.user.update({
          where: { id: user.id },
          data: { experience, level: levelAfter, coins: balance },
        });

        return {
          xp,
          coins,
          levelBefore: fresh.level,
          levelAfter,
          unlocked,
        } satisfies RushRewardView;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    const after = await db.puzzleRushRun.findUniqueOrThrow({
      where: { id: run.id },
    });

    return view(after, null, settled);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === SERIALIZATION_FAILURE
    ) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request settled this run at the same time. Fetch it again.",
      );
    }
    throw error;
  }
}

/**
 * Play the solver's moves at the run's current puzzle.
 *
 * `moves` is the whole attempt at *this puzzle*, newest last — the same
 * stateless replay the rated queue uses, for the same reason. A right move that
 * does not finish the puzzle comes back with the forced reply and the same
 * puzzle still pinned; anything that ends it moves the run on.
 */
export async function playRushMoves(input: {
  user: User;
  runId: string;
  moves: string[];
}): Promise<RushMoveView> {
  const run = await loadRun(input.user, input.runId);

  if (isOver(run)) {
    const finished = await (run.endedAt === null
      ? finishRun(input.user, run)
      : getRush(input.user, run.id));

    return { ...finished, outcome: null, reply: null, solution: null };
  }

  if (input.moves.length === 0) {
    throwProblem(HttpStatusCodes.UNPROCESSABLE_ENTITY, "Send a move to play");
  }

  if (!run.currentPuzzleId) {
    throwProblem(HttpStatusCodes.CONFLICT, "This run has no puzzle open");
  }

  const puzzle = await db.puzzle.findUniqueOrThrow({
    where: { id: run.currentPuzzleId },
  });

  let session: PuzzleSession = startPuzzle(toEnginePuzzle(puzzle));

  for (const [index, uci] of input.moves.entries()) {
    if (session.status !== "solving") {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `This puzzle was already over by move ${index + 1}.`,
      );
    }
    session = submitPuzzleMove(session, uci).session;
  }

  // The replay above consumed every move including the last, so the outcome of
  // the last one is read off the session it produced rather than played again.
  const outcome: "continue" | "solved" | "wrong" =
    session.status === "solved"
      ? "solved"
      : session.status === "failed"
        ? "wrong"
        : "continue";

  if (outcome === "continue") {
    return {
      ...(await view(run, puzzle)),
      outcome,
      // The line's forced reply is already on the session's board.
      reply: puzzle.moves[session.index - 1] ?? "",
      solution: null,
    };
  }

  const solved = run.solved + (outcome === "solved" ? 1 : 0);
  const missed = run.missed + (outcome === "wrong" ? 1 : 0);
  const solution = solutionSan(toEnginePuzzle(puzzle));

  // Out of lives, or out of time as of this submission: the run is done and
  // the score it just earned is the score it keeps.
  if (missed >= RUSH_MISS_LIMIT || outOfTime(run)) {
    const scored = await db.puzzleRushRun.update({
      where: { id: run.id },
      data: { solved, missed, currentPuzzleId: null },
    });

    const finished = await finishRun(input.user, scored);
    return { ...finished, outcome, reply: null, solution };
  }

  const served = [...run.servedPuzzleIds];
  const next = await pickRushPuzzle(solved, served);

  if (next) {
    served.push(next.id);
  }

  const advanced = await db.puzzleRushRun.update({
    where: { id: run.id },
    data: {
      solved,
      missed,
      currentPuzzleId: next?.id ?? null,
      servedPuzzleIds: served,
      // The corpus is exhausted — there is nothing left to ask, so the run
      // ends here rather than sitting on an empty board.
      endedAt: next ? undefined : new Date(),
    },
  });

  if (!next) {
    const finished = await finishRun(input.user, advanced);
    return { ...finished, outcome, reply: null, solution };
  }

  return {
    ...(await view(advanced, next)),
    outcome,
    reply: null,
    solution,
  };
}

/** Give up on the run where it stands. */
export async function endRush(user: User, runId: string): Promise<RushRunView> {
  const run = await loadRun(user, runId);

  if (run.endedAt !== null) {
    return getRush(user, runId);
  }

  return finishRun(user, run);
}

export type RushLeaderboardEntry = {
  rank: number;
  username: string;
  title: string | null;
  solved: number;
  achievedAt: string;
};

/**
 * The best runs at a mode, one per player.
 *
 * One row per player rather than per run, or the board would be a list of the
 * same three people having a good afternoon.
 */
export async function rushLeaderboard(input: {
  mode: PuzzleRushMode;
  limit: number;
}): Promise<RushLeaderboardEntry[]> {
  const rows = await db.puzzleRushRun.findMany({
    where: { mode: input.mode, endedAt: { not: null }, solved: { gt: 0 } },
    orderBy: [{ solved: "desc" }, { endedAt: "asc" }],
    // Over-fetched so that collapsing to one row per player still fills the
    // board. A player with many good runs eats several of these.
    take: input.limit * 5,
    select: {
      solved: true,
      endedAt: true,
      userId: true,
      user: {
        select: {
          username: true,
          equippedTitle: { select: { label: true } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const best: RushLeaderboardEntry[] = [];

  for (const row of rows) {
    if (seen.has(row.userId)) {
      continue;
    }
    seen.add(row.userId);

    best.push({
      rank: best.length + 1,
      username: row.user.username,
      title: row.user.equippedTitle?.label ?? null,
      solved: row.solved,
      achievedAt: (row.endedAt ?? new Date()).toISOString(),
    });

    if (best.length >= input.limit) {
      break;
    }
  }

  return best;
}

/** This player's best at each mode, for the stats screen. */
export async function rushBests(
  user: User,
): Promise<Array<{ mode: PuzzleRushMode; best: number; runs: number }>> {
  const grouped = await db.puzzleRushRun.groupBy({
    by: ["mode"],
    where: { userId: user.id, endedAt: { not: null } },
    _max: { solved: true },
    _count: { _all: true },
  });

  const byMode = new Map(grouped.map((row) => [row.mode, row]));

  return RUSH_MODES.map((mode) => ({
    mode,
    best: byMode.get(mode)?._max.solved ?? 0,
    runs: byMode.get(mode)?._count._all ?? 0,
  }));
}
