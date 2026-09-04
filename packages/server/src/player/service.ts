import { Prisma, type CoinReason, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import { levelProgress, streakIsAlive, utcDay } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { cached, invalidateCache } from "../lib/cache";
import { throwProblem } from "../lib/problem-details";

const UNIQUE_VIOLATION = "P2002";
const SERIALIZATION_FAILURE = "P2034";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === SERIALIZATION_FAILURE
  );
}

export async function getProfile(user: User) {
  const row = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    include: { equippedTitle: true },
  });

  const progress = levelProgress(row.experience);

  return {
    id: row.id,
    username: row.username,
    level: progress.level,
    experience: row.experience,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    coins: row.coins,
    equippedTitle: row.equippedTitle
      ? {
          id: row.equippedTitle.id,
          code: row.equippedTitle.code,
          label: row.equippedTitle.label,
          rarity: row.equippedTitle.rarity,
        }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getStats(user: User) {
  const stats = await db.userStats.findUniqueOrThrow({
    where: { userId: user.id },
  });

  return {
    wins: stats.wins,
    losses: stats.losses,
    draws: stats.draws,
    currentWinStreak: stats.currentWinStreak,
    topWinStreak: stats.topWinStreak,
    currentLoginStreak: stats.currentLoginStreak,
    topLoginStreak: stats.topLoginStreak,
    lastCheckInDay: stats.lastCheckInDay ? utcDay(stats.lastCheckInDay) : null,
    loginStreakAlive: streakIsAlive(
      stats.lastCheckInDay ? utcDay(stats.lastCheckInDay) : null,
      utcDay(new Date()),
    ),
    rating: stats.rating,
  };
}

const RATING_HISTORY_LIMIT = 30;

export async function getRatingHistory(
  user: User,
  limit: number = RATING_HISTORY_LIMIT,
) {
  const [stats, newest, peak] = await Promise.all([
    db.userStats.findUniqueOrThrow({
      where: { userId: user.id },
      select: { rating: true },
    }),
    db.ratingSnapshot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { rating: true, delta: true, gameId: true, createdAt: true },
    }),
    db.ratingSnapshot.aggregate({
      where: { userId: user.id },
      _max: { rating: true },
    }),
  ]);

  const history = newest.reverse();
  const oldest = history[0];

  return {
    history: history.map((point) => ({
      rating: point.rating,
      delta: point.delta,
      gameId: point.gameId,
      createdAt: point.createdAt.toISOString(),
    })),
    startingRating: oldest ? oldest.rating - oldest.delta : stats.rating,
    current: stats.rating,
    peak: peak._max.rating,
  };
}

export async function listAchievements(user: User, unlockedOnly = false) {
  const [catalog, unlocks] = await Promise.all([
    cached("achievements", "catalog", 300, () =>
      db.achievement.findMany({
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          iconUrl: true,
          xpReward: true,
          coinReward: true,
          secret: true,
        },
        orderBy: { createdAt: "asc" },
      }),
    ),
    db.userAchievement.findMany({
      where: { userId: user.id },
      select: { achievementId: true, unlockedAt: true },
    }),
  ]);

  const unlockedAtById = new Map(
    unlocks.map((row) => [row.achievementId, row.unlockedAt]),
  );

  return catalog
    .map((row) => {
      const unlockedAt = unlockedAtById.get(row.id) ?? null;

      return {
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        iconUrl: row.iconUrl,
        xpReward: row.xpReward,
        coinReward: row.coinReward,
        secret: row.secret,
        unlockedAt: unlockedAt ? unlockedAt.toISOString() : null,
      };
    })
    .filter((achievement) => {
      if (unlockedOnly) {
        return achievement.unlockedAt !== null;
      }
      return !achievement.secret || achievement.unlockedAt !== null;
    });
}

export async function listTitles(user: User) {
  const [titles, owned] = await Promise.all([
    cached("titles", "catalog", 300, () =>
      db.title.findMany({
        select: {
          id: true,
          code: true,
          label: true,
          description: true,
          price: true,
          rarity: true,
          requiredLevel: true,
          isPurchasable: true,
        },
        orderBy: [{ price: "asc" }, { code: "asc" }],
      }),
    ),
    db.userTitle.findMany({
      where: { userId: user.id },
      select: { titleId: true },
    }),
  ]);

  const ownedIds = new Set(owned.map((row) => row.titleId));

  return titles.map((title) => ({
    id: title.id,
    code: title.code,
    label: title.label,
    description: title.description,
    price: title.price,
    rarity: title.rarity,
    requiredLevel: title.requiredLevel,
    isPurchasable: title.isPurchasable,
    owned: ownedIds.has(title.id),
    affordable:
      title.isPurchasable &&
      user.coins >= title.price &&
      user.level >= title.requiredLevel,
    equipped: user.equippedTitleId === title.id,
  }));
}

export async function listOwnedTitles(user: User) {
  const rows = await db.userTitle.findMany({
    where: { userId: user.id },
    include: { title: true },
    orderBy: { purchasedAt: "desc" },
  });

  return rows.map((row) => ({
    id: row.title.id,
    code: row.title.code,
    label: row.title.label,
    description: row.title.description,
    price: row.title.price,
    rarity: row.title.rarity,
    requiredLevel: row.title.requiredLevel,
    isPurchasable: row.title.isPurchasable,
    owned: true,
    affordable: true,
    equipped: user.equippedTitleId === row.title.id,
    pricePaid: row.pricePaid,
    purchasedAt: row.purchasedAt.toISOString(),
  }));
}

export async function equipTitle(user: User, titleId: string | null) {
  if (titleId !== null) {
    const owned = await db.userTitle.findUnique({
      where: { userId_titleId: { userId: user.id, titleId } },
    });

    if (!owned) {
      throwProblem(HttpStatusCodes.FORBIDDEN, "You do not own that title");
    }
  }

  await db.user.update({
    where: { id: user.id },
    data: { equippedTitleId: titleId },
  });

  await invalidateCache("leaderboard");

  return getProfile(user);
}

export async function purchaseTitle(user: User, titleId: string) {
  try {
    return await db.$transaction(
      async (tx) => {
        const title = await tx.title.findUnique({ where: { id: titleId } });

        if (!title) {
          throwProblem(HttpStatusCodes.NOT_FOUND, "No such title");
        }

        if (!title.isPurchasable) {
          throwProblem(
            HttpStatusCodes.FORBIDDEN,
            "That title is not for sale — it is earned, not bought",
          );
        }

        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });

        if (fresh.level < title.requiredLevel) {
          throwProblem(
            HttpStatusCodes.FORBIDDEN,
            `That title unlocks at level ${title.requiredLevel}; you are level ${fresh.level}`,
          );
        }

        if (fresh.coins < title.price) {
          throwProblem(
            HttpStatusCodes.CONFLICT,
            `That title costs ${title.price} coins; you have ${fresh.coins}`,
          );
        }

        const balanceAfter = fresh.coins - title.price;

        await tx.userTitle.create({
          data: {
            userId: user.id,
            titleId: title.id,
            pricePaid: title.price,
          },
        });

        await tx.coinTransaction.create({
          data: {
            userId: user.id,
            amount: -title.price,
            reason: "PURCHASE",
            balanceAfter,
          },
        });

        await tx.user.update({
          where: { id: user.id },
          data: { coins: balanceAfter },
        });

        return {
          title: {
            id: title.id,
            code: title.code,
            label: title.label,
            description: title.description,
            price: title.price,
            rarity: title.rarity,
            requiredLevel: title.requiredLevel,
            isPurchasable: title.isPurchasable,
            owned: true,
            affordable: true,
            equipped: fresh.equippedTitleId === title.id,
          },
          coins: balanceAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throwProblem(HttpStatusCodes.CONFLICT, "You already own that title");
    }
    if (isSerializationFailure(error)) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request changed your balance at the same time. Try again.",
      );
    }
    throw error;
  }
}

export async function listTransactions(input: {
  user: User;
  limit: number;
  cursor?: { ts: Date; id: string };
  reason?: CoinReason;
}) {
  const rows = await db.coinTransaction.findMany({
    where: {
      userId: input.user.id,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.cursor
        ? {
            OR: [
              { createdAt: { lt: input.cursor.ts } },
              { createdAt: input.cursor.ts, id: { lt: input.cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const last = rows.length > input.limit ? page[page.length - 1] : null;

  return {
    transactions: page.map((row) => ({
      id: row.id,
      amount: row.amount,
      reason: row.reason,
      gameId: row.gameId,
      balanceAfter: row.balanceAfter,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}

export type LeaderboardSort = "rating" | "level" | "wins";

export async function getLeaderboard(input: {
  user: User;
  sort: LeaderboardSort;
  page: number;
  limit: number;
}) {
  const { entries, total } = await cached(
    "leaderboard",
    `${input.sort}:${input.page}:${input.limit}`,
    60,
    async () => {
      const orderBy: Prisma.UserOrderByWithRelationInput[] =
        input.sort === "level"
          ? [{ level: "desc" }, { experience: "desc" }, { id: "asc" }]
          : input.sort === "wins"
            ? [{ stats: { wins: "desc" } }, { id: "asc" }]
            : [{ stats: { rating: "desc" } }, { id: "asc" }];

      const skip = (input.page - 1) * input.limit;

      const [rows, total] = await Promise.all([
        db.user.findMany({
          include: { stats: true, equippedTitle: true },
          orderBy,
          skip,
          take: input.limit,
        }),
        db.user.count(),
      ]);

      return {
        entries: rows.map((row, index) => ({
          rank: skip + index + 1,
          userId: row.id,
          username: row.username,
          level: row.level,
          experience: row.experience,
          rating: row.stats?.rating ?? 0,
          wins: row.stats?.wins ?? 0,
          title: row.equippedTitle?.label ?? null,
        })),
        total,
      };
    },
  );

  return {
    entries: entries.map((entry) => ({
      ...entry,
      you: entry.userId === input.user.id,
    })),
    total,
    page: input.page,
  };
}
