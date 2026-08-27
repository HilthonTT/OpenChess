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

/**
 * Puzzle collections: a motif, a number, and something to show for it.
 *
 * The sets themselves are a catalog in @openchess/shared. What lives here is
 * the only two questions the server is asked about them — how far along am I,
 * and pay me — and the answer to the first is the reason there is so little
 * else:
 *
 * **Progress is a query, not a counter.** How far along a collection you are is
 * the number of distinct puzzles carrying its theme that you have a *solved*
 * attempt for. `@@unique([userId, puzzleId])` on PuzzleAttempt means one row per
 * puzzle per player, so counting rows is counting puzzles with no `DISTINCT` to
 * get wrong. Nothing is incremented anywhere, which is what makes a collection
 * added today already part-finished for someone who has been training that
 * motif for months — and what makes it impossible for a counter to drift away
 * from the attempts it was meant to be counting.
 *
 * **The claim is the only row.** It exists so the payout is exactly-once, the
 * same way a `PuzzleAttempt` is what makes a puzzle's own reward exactly-once.
 *
 * One consequence worth stating: a collection can go *backwards*, in the sense
 * that its target is a fixed number and the corpus behind it is not. Import
 * more pins and `available` grows while `solved` does not. That is the honest
 * reading — you have solved what you have solved — and it is why the view
 * carries the corpus size beside the target rather than a bare percentage.
 */

const UNIQUE_VIOLATION = "P2002";

export type PuzzleCollectionView = {
  id: string;
  name: string;
  description: string;
  /** The raw theme tag, so a client can hand it straight to the trainer. */
  theme: string;
  /** What the theme is called, from the same catalog the trainer reads. */
  themeLabel: string;
  target: number;
  /** Distinct puzzles carrying the theme that you have solved. */
  solved: number;
  /** How many of them the corpus holds at all. */
  available: number;
  /** True once `solved` has reached `target`. */
  complete: boolean;
  xpReward: number;
  coinReward: number;
  /** When the reward was taken, or null while it is still owed or unearned. */
  claimedAt: string | null;
};

export type ClaimCollectionResult = {
  collection: PuzzleCollectionView;
  /** The payout, or null when this claim was a retry of one already paid. */
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

/** Postgres hands back `bigint` for `count(*)`, which does not survive JSON. */
function toCount(value: bigint | number): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/**
 * For each theme the collections care about: how many the corpus has, and how
 * many this player has solved.
 *
 * Narrowed to the collections' own themes rather than grouping the whole
 * corpus, which is what `puzzleThemeSummary` next door does — it is answering
 * "every theme there is" and pays for a full scan (and caches it); this is
 * answering "these nine", and the theme filter is exactly what the GIN index on
 * `Puzzle.themes` is for.
 *
 * A `LEFT JOIN` on the attempts, so a theme nobody here has ever met still
 * comes back with its corpus size and a zero, rather than going missing and
 * being read as "no such theme".
 */
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

/** Every collection, with this player's progress against each. */
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

/**
 * Take the reward for a finished collection.
 *
 * Deliberately a request rather than something that happens on the solve that
 * completes it. Paying automatically would mean every puzzle submission running
 * nine progress queries on the off-chance one of them just tipped over, to
 * deliver news the player is not looking at — and it would put the collection's
 * XP inside a transaction whose whole job is to settle one puzzle. Asking for
 * it costs one keypress on a screen the player is already on, and keeps the
 * puzzle path exactly as fast as it was.
 *
 * Idempotent, in the shape the rest of the codebase uses for payouts: the claim
 * row is the exactly-once key, a second claim collides on it, and the caller
 * gets the collection back with `reward: null` rather than an error — a retry
 * whose response was lost deserves the same answer as the request it repeats.
 */
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
        // Re-read inside the transaction, as every payout path here does: the
        // request-scoped user predates it, and a concurrent puzzle payout or
        // purchase may have moved coins or XP since.
        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });

        // The claim. A second one lands here and throws the unique violation
        // caught below, which is what makes the payout exactly-once.
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
            // The ledger's `@@unique([userId, reason, periodKey])` makes this
            // row exactly-once on its own terms. Belt to the claim row's
            // braces: the two guards are written in the same transaction, so
            // either one holding is enough, and neither can be the reason the
            // other was skipped.
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
      error.code === UNIQUE_VIOLATION
    ) {
      // Already claimed: a retry, or two clients at once. Nothing is owed and
      // nothing has moved, so the answer is the collection as it stands.
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
