import type { Prisma } from "@openchess/database";

/**
 * Granting achievements, shared by everything that can unlock one.
 *
 * Two callers today — a settled game's payout and the daily check-in — and both
 * want exactly this: take the codes whose rules are satisfied, keep the ones
 * that both exist in the catalog and are not already held, write the unlock rows
 * plus any title that rides along, and hand back only what was genuinely new so
 * the caller can bank the bonus and tell the player about it.
 *
 * Everything keys off `Achievement.code`, the schema's stable key, never display
 * copy. A code with no row in the table unlocks nothing, silently, which is what
 * lets a rule and its copy ship independently.
 */

/**
 * Titles awarded by an achievement rather than sold: unlocking the key grants
 * the title in the same transaction. Both sides are the seeded stable codes
 * (`scripts/seed.ts`).
 */
const TITLE_BY_ACHIEVEMENT: Record<string, string> = {
  HUNDRED_WINS: "CENTURION",
  IRON_WALL: "THE_WALL",
  DAILY_STREAK_30: "THE_REGULAR",
};

/** A newly unlocked achievement, as the client is told about it. */
export type Unlocked = {
  code: string;
  name: string;
  description: string;
  xpReward: number;
  coinReward: number;
};

/**
 * Unlock every code in `codes` this user does not already hold, inside `tx`.
 * Returns only the newly unlocked rows — empty when there is nothing new, which
 * is the common case and costs a single query to establish.
 */
export async function unlockAchievements(
  tx: Prisma.TransactionClient,
  userId: string,
  codes: string[],
): Promise<Unlocked[]> {
  if (codes.length === 0) {
    return [];
  }

  const candidates = await tx.achievement.findMany({
    where: { code: { in: codes } },
  });

  const held = await tx.userAchievement.findMany({
    where: {
      userId,
      achievementId: { in: candidates.map((achievement) => achievement.id) },
    },
    select: { achievementId: true },
  });

  const heldIds = new Set(held.map((row) => row.achievementId));
  const unlocked = candidates.filter(
    (achievement) => !heldIds.has(achievement.id),
  );

  if (unlocked.length === 0) {
    return [];
  }

  await tx.userAchievement.createMany({
    data: unlocked.map((achievement) => ({
      userId,
      achievementId: achievement.id,
    })),
    skipDuplicates: true,
  });

  const titleCodes = unlocked.flatMap((achievement) => {
    const code = TITLE_BY_ACHIEVEMENT[achievement.code];
    return code === undefined ? [] : [code];
  });

  if (titleCodes.length > 0) {
    const titles = await tx.title.findMany({
      where: { code: { in: titleCodes } },
    });

    // `skipDuplicates` rides the same `@@unique([userId, titleId])` the store
    // leans on: a title somehow already owned is left alone, not an error that
    // would roll back the whole payout.
    await tx.userTitle.createMany({
      data: titles.map((title) => ({
        userId,
        titleId: title.id,
        // Granted, not bought.
        pricePaid: 0,
      })),
      skipDuplicates: true,
    });
  }

  return unlocked.map((achievement) => ({
    code: achievement.code,
    name: achievement.name,
    description: achievement.description,
    xpReward: achievement.xpReward,
    coinReward: achievement.coinReward,
  }));
}
