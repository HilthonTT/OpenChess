import { Prisma, type CoinReason, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import { levelProgress } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { cached, invalidateCache } from "../lib/cache";
import { throwProblem } from "../lib/problem-details";

/**
 * Everything that hangs off a player rather than a game: the profile, the
 * store, the ledger, the leaderboard.
 *
 * The one routine here with teeth is `purchaseTitle`, which spends currency and
 * so is written the same way the reward pipeline is — one transaction, with the
 * database's own unique constraint as the backstop against a double purchase.
 */

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
    rating: stats.rating,
  };
}

/**
 * The achievement catalog, with the caller's unlock state on each row.
 *
 * A secret achievement is withheld until it is earned — that is the entire
 * purpose of the `secret` column, and listing them locked would give the game
 * away.
 */
export async function listAchievements(user: User, unlockedOnly = false) {
  // The catalog is the same for everyone and changes only when the seed runs;
  // the caller's unlock rows are the only per-user part, so only those are
  // read fresh. Cached as a projection: rows round-trip through JSON.
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
  // Same split as the achievement catalog: the titles themselves are global
  // and cacheable, ownership and affordability are computed per caller.
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

/** Titles the caller owns. The store's `owned` flag is the same fact, seen from the shop. */
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

/** Equip a title, or pass null to clear it. */
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

  // The equipped title's label is displayed on leaderboard rows.
  await invalidateCache("leaderboard");

  return getProfile(user);
}

/**
 * Buy a title.
 *
 * Serializable, like the game reward path, because this reads the coin balance
 * and then writes an absolute new value. `@@unique([userId, titleId])` only
 * guards against buying the *same* title twice; it does nothing for two
 * *different* titles racing on one balance. Without serialization both reads
 * see the old balance and the second write silently loses the first deduction,
 * so a player with 100 coins could buy two 100-coin titles and pay for one.
 * Under Serializable the two writes to the same user row collide and the loser
 * gets a serialization failure, which we surface as a 409 the client retries.
 *
 * One transaction: check, then write the ownership row, the ledger entry, and
 * the cached balance together.
 */
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

        // Read the balance inside the transaction: the cached one on `user` was
        // read before the request and a concurrent game may have paid out since.
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
            // Store prices change; the receipt records what was actually paid.
            pricePaid: title.price,
          },
        });

        await tx.coinTransaction.create({
          data: {
            userId: user.id,
            // Negative: spent, not earned.
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
    // A concurrent spend touched the same balance; the client refetches its
    // coins and tries again rather than silently losing a deduction.
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
  cursor?: Date;
  reason?: CoinReason;
}) {
  const rows = await db.coinTransaction.findMany({
    where: {
      userId: input.user.id,
      ...(input.cursor ? { createdAt: { lt: input.cursor } } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const more = rows.length > input.limit;

  return {
    transactions: page.map((row) => ({
      id: row.id,
      amount: row.amount,
      reason: row.reason,
      gameId: row.gameId,
      balanceAfter: row.balanceAfter,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: more
      ? (page[page.length - 1]?.createdAt.toISOString() ?? null)
      : null,
  };
}

export type LeaderboardSort = "rating" | "level" | "wins";

/**
 * The leaderboard.
 *
 * Offset-paginated rather than cursor-paginated, because a rank is only
 * meaningful as an absolute position — and an offset is the only thing that
 * gives you one. Each sort lands on an index the schema already carries:
 * `UserStats.rating`, `UserStats.wins`, and `User[level, experience]`.
 */
export async function getLeaderboard(input: {
  user: User;
  sort: LeaderboardSort;
  page: number;
  limit: number;
}) {
  // The board is identical for every viewer except the `you` flag, so the
  // cached value is the viewer-independent page and `you` is stamped on per
  // request. Invalidated wherever a leaderboard-visible fact changes (game
  // settlement, equipping a title, a new user); the 60s TTL is the staleness
  // ceiling if a bump is ever lost.
  const { entries, total } = await cached(
    "leaderboard",
    `${input.sort}:${input.page}:${input.limit}`,
    60,
    async () => {
      // Every sort ends on `id` so tied players fall in a fixed order. Without
      // a unique terminal key Postgres may order ties differently between the
      // page-N and page-N+1 queries, so a tied player could show up on both
      // pages or on neither, and `rank` (skip + index) would disagree run to
      // run.
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
