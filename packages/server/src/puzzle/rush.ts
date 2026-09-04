import {
  Prisma,
  type Puzzle as PuzzleRow,
  type PuzzleRushMode,
  type PuzzleRushRun,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  puzzleRatingBand,
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

const SERIALIZATION_FAILURE = "P2034";

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
  livesLeft: number;
  puzzle: PuzzleView | null;
  endsAt: string | null;
  endedAt: string | null;
  over: boolean;
  rewards: RushRewardView | null;
  best: number;
};

export type RushMoveView = RushRunView & {
  outcome: "continue" | "solved" | "wrong" | null;
  reply: string | null;
  solution: string[] | null;
};

function livesLeft(missed: number): number {
  return Math.max(0, RUSH_MISS_LIMIT - missed);
}

function outOfTime(run: PuzzleRushRun, now = Date.now()): boolean {
  return run.endsAt !== null && now >= run.endsAt.getTime();
}

function expiredAt(run: PuzzleRushRun, now = Date.now()): Date {
  return outOfTime(run, now) ? (run.endsAt as Date) : new Date(now);
}

function isOver(run: PuzzleRushRun, now = Date.now()): boolean {
  return (
    run.endedAt !== null || run.missed >= RUSH_MISS_LIMIT || outOfTime(run, now)
  );
}

async function pickRushPuzzle(
  solved: number,
  exclude: string[],
): Promise<PuzzleRow | null> {
  const band = puzzleRatingBand(rushRatingTarget(solved));
  const target = band.min + Math.random() * (band.max - band.min);
  const notSeen = exclude.length > 0 ? { id: { notIn: exclude } } : {};

  const above = await db.puzzle.findFirst({
    where: { rating: { gte: target }, ...notSeen },
    orderBy: { rating: "asc" },
  });

  if (above) {
    return above;
  }

  return db.puzzle.findFirst({
    where: { rating: { lt: target }, ...notSeen },
    orderBy: { rating: "desc" },
  });
}

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

export async function startRush(input: {
  user: User;
  mode: PuzzleRushMode;
}): Promise<RushRunView> {
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

async function loadRun(user: User, runId: string): Promise<PuzzleRushRun> {
  const run = await db.puzzleRushRun.findUnique({ where: { id: runId } });

  if (!run || run.userId !== user.id) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such run");
  }

  return run;
}

export async function getRush(user: User, runId: string): Promise<RushRunView> {
  const run = await loadRun(user, runId);

  if (isOver(run) && run.endedAt === null) {
    return finishRun(user, run);
  }

  const puzzle = run.currentPuzzleId
    ? await db.puzzle.findUnique({ where: { id: run.currentPuzzleId } })
    : null;

  return view(run, puzzle);
}

async function finishRun(user: User, run: PuzzleRushRun): Promise<RushRunView> {
  const reward = rushReward(run.solved, run.mode);

  try {
    const settled = await db.$transaction(
      async (tx) => {
        const claimed = await tx.puzzleRushRun.updateMany({
          where: { id: run.id, rewardsGranted: false },
          data: {
            endedAt: run.endedAt ?? expiredAt(run),
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
      reply: puzzle.moves[session.index - 1] ?? "",
      solution: null,
    };
  }

  const solved = run.solved + (outcome === "solved" ? 1 : 0);
  const missed = run.missed + (outcome === "wrong" ? 1 : 0);
  const solution = solutionSan(toEnginePuzzle(puzzle));

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
      endedAt: next ? undefined : expiredAt(run),
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

export async function rushLeaderboard(input: {
  mode: PuzzleRushMode;
  limit: number;
}): Promise<RushLeaderboardEntry[]> {
  const rows = await db.puzzleRushRun.findMany({
    where: { mode: input.mode, endedAt: { not: null }, solved: { gt: 0 } },
    orderBy: [{ solved: "desc" }, { endedAt: "asc" }],
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
