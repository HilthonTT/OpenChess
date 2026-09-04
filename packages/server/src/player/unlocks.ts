import type { Prisma } from "@openchess/database";

const TITLE_BY_ACHIEVEMENT: Record<string, string> = {
  HUNDRED_WINS: "CENTURION",
  IRON_WALL: "THE_WALL",
  DAILY_STREAK_30: "THE_REGULAR",
  PUZZLE_HUNDRED: "PUZZLE_MASTER",
};

export type Unlocked = {
  code: string;
  name: string;
  description: string;
  xpReward: number;
  coinReward: number;
};

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

    await tx.userTitle.createMany({
      data: titles.map((title) => ({
        userId,
        titleId: title.id,
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
