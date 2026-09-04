import { Prisma, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  findPuzzleCollection,
  puzzleThemeLabel,
  PUZZLE_COLLECTIONS,
  type PuzzleCollection,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { levelFor } from "../game/rules";
import { throwProblem } from "../lib/problem-details";

const UNIQUE_VIOLATION = "P2002";
const SERIALIZATION_FAILURE = "P2034";

export type PuzzleCollectionView = {
  id: string;
  name: string;
  description: string;
  theme: string;
  themeLabel: string;
  target: number;
  solved: number;
  available: number;
  complete: boolean;
  xpReward: number;
  coinReward: number;
  claimedAt: string | null;
};

export type ClaimCollectionResult = {
  collection: PuzzleCollectionView;
  reward: {
    xp: number;
    coins: number;
    levelBefore: number;
    levelAfter: number;
  } | null;
};

type ThemeTallyRow = {
  theme: string;
  solved: bigint | number;
  available: bigint | number;
};

function toCount(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

async function tallyThemes(
  userId: string,
  themes: string[],
): Promise<Map<string, { solved: number; available: number }>> {
  const rows = await db.$queryRaw<ThemeTallyRow[]>`
    SELECT t.theme AS theme,
           COUNT(*) AS available,
           COUNT(a.id) FILTER (WHERE a.solved) AS solved
    FROM "Puzzle" p
    CROSS JOIN LATERAL unnest(p.themes) AS t(theme)
    LEFT JOIN "PuzzleAttempt" a
      ON a."puzzleId" = p.id AND a."userId" = ${userId}
    WHERE t.theme = ANY(${themes})
    GROUP BY t.theme
  `;

  return new Map(
    rows.map((row) => [
      row.theme,
      { solved: toCount(row.solved), available: toCount(row.available) },
    ]),
  );
}

function view(
  entry: PuzzleCollection,
  tally: { solved: number; available: number } | undefined,
  claimedAt: Date | null,
): PuzzleCollectionView {
  const solved = tally?.solved ?? 0;

  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    theme: entry.theme,
    themeLabel: puzzleThemeLabel(entry.theme),
    target: entry.target,
    solved,
    available: tally?.available ?? 0,
    complete: solved >= entry.target,
    xpReward: entry.xpReward,
    coinReward: entry.coinReward,
    claimedAt: claimedAt?.toISOString() ?? null,
  };
}

export async function listCollections(
  user: User,
): Promise<PuzzleCollectionView[]> {
  const themes = [...new Set(PUZZLE_COLLECTIONS.map((entry) => entry.theme))];

  const [tally, claims] = await Promise.all([
    tallyThemes(user.id, themes),
    db.puzzleCollectionClaim.findMany({
      where: { userId: user.id },
      select: { collectionId: true, claimedAt: true },
    }),
  ]);

  const claimed = new Map(
    claims.map((claim) => [claim.collectionId, claim.claimedAt]),
  );

  return PUZZLE_COLLECTIONS.map((entry) =>
    view(entry, tally.get(entry.theme), claimed.get(entry.id) ?? null),
  );
}

export async function claimCollection(
  user: User,
  collectionId: string,
): Promise<ClaimCollectionResult> {
  const entry = findPuzzleCollection(collectionId);

  if (!entry) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such collection");
  }

  const tally = (await tallyThemes(user.id, [entry.theme])).get(entry.theme);
  const solved = tally?.solved ?? 0;

  if (solved < entry.target) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `${entry.name} is not finished — ${solved} of ${entry.target} solved.`,
    );
  }

  try {
    const reward = await db.$transaction(
      async (tx) => {
        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });

        await tx.puzzleCollectionClaim.create({
          data: {
            userId: user.id,
            collectionId: entry.id,
            solvedAtClaim: solved,
            xpAwarded: entry.xpReward,
            coinsAwarded: entry.coinReward,
          },
        });

        const experience = fresh.experience + entry.xpReward;
        const levelAfter = levelFor(experience);
        const balance = fresh.coins + entry.coinReward;

        await tx.coinTransaction.create({
          data: {
            userId: user.id,
            amount: entry.coinReward,
            reason: "PUZZLE_COLLECTION",
            periodKey: entry.id,
            balanceAfter: balance,
          },
        });

        await tx.user.update({
          where: { id: user.id },
          data: { experience, level: levelAfter, coins: balance },
        });

        return {
          xp: entry.xpReward,
          coins: entry.coinReward,
          levelBefore: fresh.level,
          levelAfter,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      collection: view(entry, tally, new Date()),
      reward,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === SERIALIZATION_FAILURE
    ) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request touched your account at the same time. Fetch it again.",
      );
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      const claim = await db.puzzleCollectionClaim.findUnique({
        where: {
          userId_collectionId: { userId: user.id, collectionId: entry.id },
        },
        select: { claimedAt: true },
      });

      return {
        collection: view(entry, tally, claim?.claimedAt ?? new Date()),
        reward: null,
      };
    }

    throw error;
  }
}
