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

export type PuzzleRewardView = {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  ratingBefore: number;
  ratingAfter: number;
  streak: number;
  unlocked: Unlocked[];
};

export type PuzzleMoveView =
  | {
      outcome: "continue";
      reply: string;
      expected: null;
      solution: null;
      rewards: null;
    }
  | {
      outcome: "solved";
      reply: null;
      expected: null;
      solution: string[];
      rewards: PuzzleRewardView | null;
    }
  | {
      outcome: "wrong";
      reply: null;
      expected: string;
      solution: string[];
      rewards: PuzzleRewardView | null;
    };

const SERIALIZATION_FAILURE = "P2034";

const UNIQUE_VIOLATION = "P2002";

async function statsFor(userId: string) {
  return db.userStats.findUniqueOrThrow({ where: { userId } });
}

function replaySession(row: PuzzleRow, solverMoves: string[]): PuzzleSession {
  let session = startPuzzle(toEnginePuzzle(row));

  for (const [index, uci] of solverMoves.entries()) {
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

export async function playPuzzleMoves(input: {
  user: User;
  puzzleId: string;
  moves: string[];
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

function replyUci(row: PuzzleRow, session: PuzzleSession): string {
  return row.moves[session.index - 1] ?? "";
}

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

export async function revealPuzzleSolution(input: {
  user: User;
  puzzleId: string;
  moves: string[];
}): Promise<{ solution: string[]; line: string[]; rewards: null }> {
  const row = await db.puzzle.findUnique({ where: { id: input.puzzleId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such puzzle");
  }

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
    rewards: null,
  };
}

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

async function pickPuzzle(
  userId: string,
  rating: number,
  theme?: string | null,
): Promise<PuzzleRow | null> {
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

  return db.puzzle.findFirst({
    where: { attempts: { none: { userId } }, ...themed },
    orderBy: { rating: "asc" },
  });
}

export type NextPuzzle = {
  puzzle: PuzzleView | null;
  rating: number;
  streak: number;
  theme: string | null;
};

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

function utcToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function isTodaysPuzzle(dailyOn: Date | null): boolean {
  return dailyOn !== null && dailyOn.getTime() === utcToday().getTime();
}

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
    theme: null,
  };
}

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
      return db.puzzle.findUnique({ where: { dailyOn: day } });
    }
    throw error;
  }
}

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
  trainable: boolean;
  available: number;
  attempted: number;
  solved: number;
};

type ThemeCountRow = { theme: string; total: bigint | number };
type ThemeRecordRow = {
  theme: string;
  attempted: bigint | number;
  solved: bigint | number;
};

function toCount(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

async function themeCounts(): Promise<Map<string, number>> {
  const rows = await cached("puzzle-themes", "counts", 3600, async () => {
    const result = await db.$queryRaw<ThemeCountRow[]>`
      SELECT t.theme AS theme, COUNT(*) AS total
      FROM "Puzzle" p
      CROSS JOIN LATERAL unnest(p.themes) AS t(theme)
      GROUP BY t.theme
    `;

    return result.map((row) => ({
      theme: row.theme,
      total: toCount(row.total),
    }));
  });

  return new Map(rows.map((row) => [row.theme, row.total]));
}

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
