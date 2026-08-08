import {
  Prisma,
  type Puzzle as PuzzleRow,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  PUZZLE_THEMES,
  puzzleHint,
  puzzleRatingBand,
  puzzleThemeLabel,
  solutionSan,
  startPuzzle,
  submitPuzzleMove,
  type PuzzleSession,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { satisfiedPuzzleCodes } from "../game/achievements";
import { cached } from "../lib/cache";
import { throwProblem } from "../lib/problem-details";
import { levelFor } from "../game/rules";
import { unlockAchievements, type Unlocked } from "../player/unlocks";
import { clearHint, markHintUsed, wasHintUsed } from "./hints";
import {
  puzzleReward,
  puzzleStreakAfter,
  ratingAfterAttempt,
  toEnginePuzzle,
  toPuzzleView,
  type PuzzleView,
} from "./rules";

/**
 * The puzzle service.
 *
 * Solving is a server round trip per move, not a client-side check. The reason
 * is the same one the game service gives for never trusting a board: the answer
 * is the thing being asked for, so a client that held the line could not
 * honestly be asked to find it. The client sends the moves it has played and
 * gets back "right, and here is the reply" or "wrong, and here is the answer";
 * the line itself only ever leaves the server once the puzzle is over.
 *
 * The attempt is settled — rated and paid — on the request that ends the
 * puzzle, and exactly once: `@@unique([userId, puzzleId])` on PuzzleAttempt is
 * the idempotency key, so a retried submission collides instead of paying
 * twice, and a puzzle already attempted can be replayed freely for practice
 * without touching rating or coins.
 */

export type PuzzleRewardView = {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  ratingBefore: number;
  ratingAfter: number;
  /** The puzzle solve streak after this attempt. */
  streak: number;
  unlocked: Unlocked[];
};

export type PuzzleMoveView =
  | {
      outcome: "continue";
      /** The reply the line forces, already on the board. UCI. */
      reply: string;
      expected: null;
      solution: null;
      rewards: null;
    }
  | {
      outcome: "solved";
      reply: null;
      expected: null;
      /** The solver's moves in SAN, revealed now the puzzle is over. */
      solution: string[];
      /** Null when the puzzle had already been attempted for credit. */
      rewards: PuzzleRewardView | null;
    }
  | {
      outcome: "wrong";
      reply: null;
      /** The move that was wanted, in UCI. */
      expected: string;
      solution: string[];
      rewards: PuzzleRewardView | null;
    };

/** Postgres could not serialize a concurrent transaction — the caller retries. */
const SERIALIZATION_FAILURE = "P2034";
/** A unique constraint was violated — here, always the one-attempt-per-puzzle one. */
const UNIQUE_VIOLATION = "P2002";

async function statsFor(userId: string) {
  return db.userStats.findUniqueOrThrow({ where: { userId } });
}

/**
 * Rebuild the session a client is partway through.
 *
 * The client's `moves` are its own solver moves in order — the opponent's
 * replies are the server's to play, so they are never sent. Replaying them is
 * what makes the request stateless: any instance can answer it, and a client
 * that retries a request it never saw the answer to sends the same list and
 * gets the same reply.
 */
function replaySession(row: PuzzleRow, solverMoves: string[]): PuzzleSession {
  let session = startPuzzle(toEnginePuzzle(row));

  for (const [index, uci] of solverMoves.entries()) {
    // A prefix that does not solve cleanly means the client is sending a list
    // it never got a "right" for. That is a malformed request, not a wrong
    // move: the wrong move it *is* reporting is the last one in the list.
    if (session.status !== "solving") {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `This puzzle was already over by move ${index + 1}. Start it again.`,
      );
    }

    const result = submitPuzzleMove(session, uci);
    session = result.session;
  }

  return session;
}

/**
 * Settle an attempt: rating, streak, XP, coins, achievements, in one
 * transaction.
 *
 * Returns null when the puzzle had already been attempted for credit — the
 * insert collides on the unique key, and a replay must move nothing.
 */
async function settleAttempt(input: {
  user: User;
  puzzle: PuzzleRow;
  solved: boolean;
  hintUsed: boolean;
  msSpent: number | null;
}): Promise<PuzzleRewardView | null> {
  const { user, puzzle } = input;

  try {
    return await db.$transaction(
      async (tx) => {
        // Re-read inside the transaction, as every payout path here does: the
        // request-scoped user predates it, and a concurrent game payout or
        // purchase may have moved coins, XP or the rating since.
        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        const stats = await tx.userStats.findUniqueOrThrow({
          where: { userId: user.id },
        });

        const ratingAfter = ratingAfterAttempt({
          rating: stats.puzzleRating,
          puzzleRating: puzzle.rating,
          solved: input.solved,
          hintUsed: input.hintUsed,
          scored: true,
        });

        const reward = puzzleReward({
          solved: input.solved,
          hintUsed: input.hintUsed,
          puzzleRating: puzzle.rating,
          solverRating: stats.puzzleRating,
          scored: true,
        });

        // The claim. A second submission for the same puzzle lands here and
        // throws the unique violation caught below, which is what makes the
        // whole payout exactly-once without a separate guard column.
        await tx.puzzleAttempt.create({
          data: {
            userId: user.id,
            puzzleId: puzzle.id,
            solved: input.solved,
            hintUsed: input.hintUsed,
            msSpent: input.msSpent,
            ratingBefore: stats.puzzleRating,
            ratingAfter,
            xpAwarded: reward.xp,
            coinsAwarded: reward.coins,
          },
        });

        const streak = puzzleStreakAfter(
          stats.currentPuzzleStreak,
          input.solved,
        );

        const updatedStats = await tx.userStats.update({
          where: { userId: user.id },
          data: {
            puzzleRating: ratingAfter,
            puzzlesAttempted: stats.puzzlesAttempted + 1,
            puzzlesSolved: stats.puzzlesSolved + (input.solved ? 1 : 0),
            currentPuzzleStreak: streak,
            topPuzzleStreak: Math.max(stats.topPuzzleStreak, streak),
          },
        });

        await tx.puzzle.update({
          where: { id: puzzle.id },
          data: {
            plays: { increment: 1 },
            solves: { increment: input.solved ? 1 : 0 },
          },
        });

        const unlocked = await unlockAchievements(
          tx,
          user.id,
          satisfiedPuzzleCodes({
            solved: input.solved,
            puzzlesSolved: updatedStats.puzzlesSolved,
            streak,
            puzzleRating: puzzle.rating,
            daily: isTodaysPuzzle(puzzle.dailyOn),
          }),
        );

        const bonusXp = unlocked.reduce(
          (sum, entry) => sum + entry.xpReward,
          0,
        );
        const bonusCoins = unlocked.reduce(
          (sum, entry) => sum + entry.coinReward,
          0,
        );

        const xp = reward.xp + bonusXp;
        const coins = reward.coins + bonusCoins;
        const experience = fresh.experience + xp;
        const levelAfter = levelFor(experience);
        const balance = fresh.coins + coins;

        if (coins > 0) {
          // No gameId, so the ledger's `@@unique([userId, gameId, reason])`
          // does not constrain this row — the attempt's own unique key is what
          // makes it exactly-once, and it was claimed above.
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
          ratingBefore: stats.puzzleRating,
          ratingAfter,
          streak,
          unlocked,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Already attempted: a replay, or a retried submission whose first
      // attempt landed. Either way nothing is owed and nothing has moved.
      if (error.code === UNIQUE_VIOLATION) {
        return null;
      }

      if (error.code === SERIALIZATION_FAILURE) {
        throwProblem(
          HttpStatusCodes.CONFLICT,
          "Another request settled this puzzle at the same time. Fetch it again.",
        );
      }
    }
    throw error;
  }
}

/**
 * Play the solver's moves and report what happened.
 *
 * `moves` is the whole attempt so far, newest last. The server replays it
 * rather than holding session state, so nothing has to be kept between
 * requests and any instance can answer.
 */
export async function playPuzzleMoves(input: {
  user: User;
  puzzleId: string;
  moves: string[];
  /** The client's own report; the server's own mark is honoured too. */
  hintUsed?: boolean;
  msSpent?: number;
}): Promise<PuzzleMoveView> {
  const row = await db.puzzle.findUnique({ where: { id: input.puzzleId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such puzzle");
  }

  if (input.moves.length === 0) {
    throwProblem(HttpStatusCodes.UNPROCESSABLE_ENTITY, "Send a move to play");
  }

  const session = replaySession(row, input.moves.slice(0, -1));

  if (session.status !== "solving") {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "This puzzle is already over. Start it again.",
    );
  }

  const result = submitPuzzleMove(
    session,
    input.moves[input.moves.length - 1]!,
  );

  if (result.outcome === "continue") {
    return {
      outcome: "continue",
      reply: replyUci(row, result.session),
      expected: null,
      solution: null,
      rewards: null,
    };
  }

  const solved = result.outcome === "solved";

  // Trusted in the "was it hinted" direction only: the client can volunteer a
  // hint it took, and the server's own record can override a client that
  // forgets to.
  const hintUsed =
    (input.hintUsed ?? false) || (await wasHintUsed(input.user.id, row.id));

  const rewards = await settleAttempt({
    user: input.user,
    puzzle: row,
    solved,
    hintUsed,
    msSpent: input.msSpent ?? null,
  });

  await clearHint(input.user.id, row.id);

  const solution = solutionSan(toEnginePuzzle(row));

  return solved
    ? { outcome: "solved", reply: null, expected: null, solution, rewards }
    : {
        outcome: "wrong",
        reply: null,
        expected: result.outcome === "wrong" ? result.expected : "",
        solution,
        rewards,
      };
}

/**
 * The opponent's reply, as UCI, from the session the move produced. Read off
 * the board rather than the stored line so it is always the move that was
 * actually played.
 */
function replyUci(row: PuzzleRow, session: PuzzleSession): string {
  // The reply is the last thing on the board; `session.index` points past it.
  return row.moves[session.index - 1] ?? "";
}

/**
 * The hint: the square the piece to move stands on.
 *
 * Taking it is recorded, because it halves the payout — see `hints.ts`.
 */
export async function takePuzzleHint(input: {
  user: User;
  puzzleId: string;
  moves: string[];
}): Promise<{ square: string }> {
  const row = await db.puzzle.findUnique({ where: { id: input.puzzleId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such puzzle");
  }

  const session = replaySession(row, input.moves);
  const square = puzzleHint(session);

  if (square === null) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "This puzzle has nothing left to hint at",
    );
  }

  await markHintUsed(input.user.id, row.id);

  return { square };
}

/** Give up: hand back the whole line, and settle the attempt as a failure. */
export async function revealPuzzleSolution(input: {
  user: User;
  puzzleId: string;
  moves: string[];
}): Promise<{ solution: string[]; line: string[]; rewards: null }> {
  const row = await db.puzzle.findUnique({ where: { id: input.puzzleId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such puzzle");
  }

  // Replayed only to reject a request whose prefix does not add up.
  replaySession(row, input.moves);

  await settleAttempt({
    user: input.user,
    puzzle: row,
    solved: false,
    hintUsed: true,
    msSpent: null,
  });

  await clearHint(input.user.id, row.id);

  return {
    solution: solutionSan(toEnginePuzzle(row)),
    line: row.moves,
    // Giving up never pays. Spelled out rather than left implicit so the shape
    // matches the move response the client already handles.
    rewards: null,
  };
}

/** Whether this player has already been scored on each of these puzzles. */
async function attemptedIds(
  userId: string,
  puzzleIds: string[],
): Promise<Set<string>> {
  if (puzzleIds.length === 0) {
    return new Set();
  }

  const rows = await db.puzzleAttempt.findMany({
    where: { userId, puzzleId: { in: puzzleIds } },
    select: { puzzleId: true },
  });

  return new Set(rows.map((row) => row.puzzleId));
}

/**
 * A puzzle near `rating` the player has not been scored on.
 *
 * Picked by seeking to a random rating inside the band and taking the nearest
 * row on either side of it, rather than by `ORDER BY random()`: the rating
 * index turns that into a seek, which matters the moment the table holds an
 * imported corpus rather than the seeded dozen. The band widens on each empty
 * pass so no rating can be stranded between two clusters of puzzles.
 */
async function pickPuzzle(
  userId: string,
  rating: number,
  theme?: string | null,
): Promise<PuzzleRow | null> {
  // `has` compiles to `themes @> ARRAY[$1]`, which is what the GIN index on the
  // column answers. Without the theme the clause is absent entirely rather than
  // matching everything, so the ordinary queue still seeks on the rating index.
  const themed = theme ? { themes: { has: theme } } : {};

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const band = puzzleRatingBand(rating, attempt);
    const target = band.min + Math.random() * (band.max - band.min);

    const unattempted = { attempts: { none: { userId } } };

    const above = await db.puzzle.findFirst({
      where: {
        rating: { gte: target, lte: band.max },
        ...unattempted,
        ...themed,
      },
      orderBy: { rating: "asc" },
    });

    if (above) {
      return above;
    }

    const below = await db.puzzle.findFirst({
      where: {
        rating: { lte: target, gte: band.min },
        ...unattempted,
        ...themed,
      },
      orderBy: { rating: "desc" },
    });

    if (below) {
      return below;
    }
  }

  // Every puzzle in range is spent. Fall back to anything unattempted at all,
  // so a player who has cleared their band still gets a puzzle rather than an
  // empty screen. The theme is kept: a player who asked to train forks would
  // rather be told there are no forks left than be handed a skewer.
  return db.puzzle.findFirst({
    where: { attempts: { none: { userId } }, ...themed },
    orderBy: { rating: "asc" },
  });
}

export type NextPuzzle = {
  puzzle: PuzzleView | null;
  /** The solver's current puzzle rating, for the header. */
  rating: number;
  streak: number;
  /** The theme this was filtered by, echoed back so a client can show it. */
  theme: string | null;
};

/** The next puzzle to serve this player, optionally of one theme. */
export async function nextPuzzle(
  user: User,
  theme?: string | null,
): Promise<NextPuzzle> {
  const stats = await statsFor(user.id);
  const row = await pickPuzzle(user.id, stats.puzzleRating, theme);

  return {
    puzzle: row
      ? toPuzzleView(row, {
          attempted: false,
          daily: isTodaysPuzzle(row.dailyOn),
        })
      : null,
    rating: stats.puzzleRating,
    streak: stats.currentPuzzleStreak,
    theme: theme ?? null,
  };
}

/** Today, as the UTC calendar day the `dailyOn` column stores. */
function utcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * Whether this row is *today's* puzzle, not merely some past day's.
 *
 * `dailyOn` is never cleared — it is the record of which day a puzzle was the
 * daily one — so a bare null check would mark every puzzle that has ever been
 * a daily as one forever, and hand out the daily achievement to anyone who met
 * a three-week-old one through the ordinary queue.
 */
function isTodaysPuzzle(dailyOn: Date | null): boolean {
  return dailyOn !== null && dailyOn.getTime() === utcToday().getTime();
}

/**
 * Today's puzzle: the same one for everybody, assigned on first request.
 *
 * The assignment is a conditional write against the unique `dailyOn` index, so
 * two players asking in the same instant cannot end up with different puzzles —
 * the loser of the race re-reads and gets the winner's.
 */
export async function dailyPuzzle(user: User): Promise<NextPuzzle> {
  const today = utcToday();
  const stats = await statsFor(user.id);

  const assigned = await db.puzzle.findUnique({ where: { dailyOn: today } });

  const row = assigned ?? (await assignDailyPuzzle(today));

  if (!row) {
    return {
      puzzle: null,
      rating: stats.puzzleRating,
      streak: stats.currentPuzzleStreak,
      theme: null,
    };
  }

  const attempted = await attemptedIds(user.id, [row.id]);

  return {
    puzzle: toPuzzleView(row, {
      attempted: attempted.has(row.id),
      daily: true,
    }),
    rating: stats.puzzleRating,
    streak: stats.currentPuzzleStreak,
    // The daily is whatever it is; nobody filtered it.
    theme: null,
  };
}

/**
 * Choose and claim today's puzzle.
 *
 * Deliberately picked from the middle of the rating range rather than at
 * random across it: one puzzle serves every player today, so it should be one
 * most of them can attempt. A candidate that loses the race to claim the day
 * is simply dropped — the winner's row is what the caller re-reads.
 */
async function assignDailyPuzzle(day: Date): Promise<PuzzleRow | null> {
  const candidates = await db.puzzle.findMany({
    where: { dailyOn: null, rating: { gte: 800, lte: 1600 } },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  const pool =
    candidates.length > 0
      ? candidates
      : await db.puzzle.findMany({ where: { dailyOn: null }, take: 50 });

  const choice = pool[Math.floor(Math.random() * pool.length)];

  if (!choice) {
    return null;
  }

  try {
    return await db.puzzle.update({
      where: { id: choice.id },
      data: { dailyOn: day },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      // Someone else claimed the day first. Theirs is the day's puzzle.
      return db.puzzle.findUnique({ where: { dailyOn: day } });
    }
    throw error;
  }
}

/** One puzzle by id, for resuming or for a shared link. */
export async function getPuzzle(
  user: User,
  puzzleId: string,
): Promise<PuzzleView> {
  const row = await db.puzzle.findUnique({ where: { id: puzzleId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such puzzle");
  }

  const attempted = await attemptedIds(user.id, [row.id]);

  return toPuzzleView(row, {
    attempted: attempted.has(row.id),
    daily: isTodaysPuzzle(row.dailyOn),
  });
}

export type PuzzleThemeSummary = {
  key: string;
  label: string;
  group: string;
  /** Whether it is worth offering as something to train on its own. */
  trainable: boolean;
  /** How many puzzles in the corpus carry it. */
  available: number;
  /** How many of them this player has been scored on, and how many they got. */
  attempted: number;
  solved: number;
};

type ThemeCountRow = { theme: string; total: bigint | number };
type ThemeRecordRow = {
  theme: string;
  attempted: bigint | number;
  solved: bigint | number;
};

/** Postgres hands back `bigint` for `count(*)`, which does not survive JSON. */
function toCount(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * How many puzzles carry each theme.
 *
 * A grouped `unnest` over the whole table, which is a sequential scan and the
 * one query here that an imported corpus makes genuinely expensive. It is also
 * a number that changes only when someone runs an import, so it is cached for
 * an hour rather than computed per visitor.
 */
async function themeCounts(): Promise<Map<string, number>> {
  const rows = await cached("puzzle-themes", "counts", 3600, async () => {
    const result = await db.$queryRaw<ThemeCountRow[]>`
      SELECT t.theme AS theme, COUNT(*) AS total
      FROM "Puzzle" p
      CROSS JOIN LATERAL unnest(p.themes) AS t(theme)
      GROUP BY t.theme
    `;

    // Narrowed to JSON-safe values before it reaches the cache, which
    // round-trips through JSON and cannot carry a bigint.
    return result.map((row) => ({
      theme: row.theme,
      total: toCount(row.total),
    }));
  });

  return new Map(rows.map((row) => [row.theme, row.total]));
}

/** This player's record at each theme they have met. */
async function themeRecord(
  userId: string,
): Promise<Map<string, ThemeRecordRow>> {
  const rows = await db.$queryRaw<ThemeRecordRow[]>`
    SELECT t.theme AS theme,
           COUNT(*) AS attempted,
           COUNT(*) FILTER (WHERE a.solved) AS solved
    FROM "PuzzleAttempt" a
    JOIN "Puzzle" p ON p.id = a."puzzleId"
    CROSS JOIN LATERAL unnest(p.themes) AS t(theme)
    WHERE a."userId" = ${userId}
    GROUP BY t.theme
  `;

  return new Map(rows.map((row) => [row.theme, row]));
}

/**
 * The themes, what each is worth training, and how this player has done at it.
 *
 * The catalog leads rather than the corpus: a theme nobody has imported a
 * puzzle for still shows, with a zero beside it, which is the honest answer to
 * "can I train forks" on a seeded database. Anything the corpus tags that the
 * catalog has never heard of is appended, so a fresh import is never silently
 * half-hidden behind a list written months earlier.
 */
export async function puzzleThemeSummary(
  user: User,
): Promise<PuzzleThemeSummary[]> {
  const [counts, record] = await Promise.all([
    themeCounts(),
    themeRecord(user.id),
  ]);

  const summarize = (
    key: string,
    label: string,
    group: string,
    trainable: boolean,
  ): PuzzleThemeSummary => {
    const mine = record.get(key);
    return {
      key,
      label,
      group,
      trainable,
      available: counts.get(key) ?? 0,
      attempted: mine ? toCount(mine.attempted) : 0,
      solved: mine ? toCount(mine.solved) : 0,
    };
  };

  const known = PUZZLE_THEMES.map((entry) =>
    summarize(entry.key, entry.label, entry.group, entry.trainable),
  );

  const catalogued = new Set(PUZZLE_THEMES.map((entry) => entry.key));
  const extra = [...counts.keys()]
    .filter((key) => !catalogued.has(key))
    .sort()
    .map((key) => summarize(key, puzzleThemeLabel(key), "motif", true));

  return [...known, ...extra];
}

export type PuzzleHistoryEntry = {
  puzzleId: string;
  rating: number;
  themes: string[];
  solved: boolean;
  hintUsed: boolean;
  ratingBefore: number;
  ratingAfter: number;
  xpAwarded: number;
  coinsAwarded: number;
  createdAt: string;
};

/** The player's recent attempts, newest first. */
export async function listPuzzleAttempts(input: {
  user: User;
  limit: number;
}): Promise<PuzzleHistoryEntry[]> {
  const rows = await db.puzzleAttempt.findMany({
    where: { userId: input.user.id },
    orderBy: { createdAt: "desc" },
    take: input.limit,
    include: { puzzle: { select: { rating: true, themes: true } } },
  });

  return rows.map((row) => ({
    puzzleId: row.puzzleId,
    rating: row.puzzle.rating,
    themes: row.puzzle.themes,
    solved: row.solved,
    hintUsed: row.hintUsed,
    ratingBefore: row.ratingBefore,
    ratingAfter: row.ratingAfter,
    xpAwarded: row.xpAwarded,
    coinsAwarded: row.coinsAwarded,
    createdAt: row.createdAt.toISOString(),
  }));
}
