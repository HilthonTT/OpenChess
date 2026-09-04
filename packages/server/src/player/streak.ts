import { Prisma, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  advanceStreak,
  dayStart,
  levelFor,
  streakReward,
  utcDay,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { invalidateCache } from "../lib/cache";
import { throwProblem } from "../lib/problem-details";
import { satisfiedStreakCodes } from "../game/achievements";
import { unlockAchievements, type Unlocked } from "./unlocks";

const SERIALIZATION_FAILURE = "P2034";

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === SERIALIZATION_FAILURE
  );
}

export type CheckInResult = {
  claimed: boolean;
  current: number;
  best: number;
  day: string;
  reward: { xp: number; coins: number };
  levelBefore: number;
  levelAfter: number;
  coins: number;
  unlocked: Unlocked[];
};

export async function checkIn(
  user: User,
  now: Date = new Date(),
): Promise<CheckInResult> {
  const today = utcDay(now);

  try {
    const result = await db.$transaction(
      async (tx) => {
        const stats = await tx.userStats.findUniqueOrThrow({
          where: { userId: user.id },
        });

        const { streak, claimed } = advanceStreak(
          {
            current: stats.currentLoginStreak,
            best: stats.topLoginStreak,
            lastDay: stats.lastCheckInDay ? utcDay(stats.lastCheckInDay) : null,
          },
          today,
        );

        const claim = claimed
          ? await tx.userStats.updateMany({
              where: {
                userId: user.id,
                OR: [
                  { lastCheckInDay: null },
                  { lastCheckInDay: { lt: dayStart(today) } },
                ],
              },
              data: {
                currentLoginStreak: streak.current,
                topLoginStreak: streak.best,
                lastCheckInDay: dayStart(today),
              },
            })
          : { count: 0 };

        if (claim.count === 0) {
          const wallet = await tx.user.findUniqueOrThrow({
            where: { id: user.id },
          });

          return {
            claimed: false,
            current: stats.currentLoginStreak,
            best: stats.topLoginStreak,
            day: today,
            reward: { xp: 0, coins: 0 },
            levelBefore: wallet.level,
            levelAfter: wallet.level,
            coins: wallet.coins,
            unlocked: [],
          };
        }

        const base = streakReward(streak.current);
        const unlocked = await unlockAchievements(
          tx,
          user.id,
          satisfiedStreakCodes(streak.current),
        );

        const bonusXp = unlocked.reduce((sum, a) => sum + a.xpReward, 0);
        const bonusCoins = unlocked.reduce((sum, a) => sum + a.coinReward, 0);

        const wallet = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });

        const xp = base.xp + bonusXp;
        const experience = wallet.experience + xp;
        const levelAfter = levelFor(experience);

        let balance = wallet.coins;
        const ledger: Prisma.CoinTransactionCreateManyInput[] = [];

        if (base.coins > 0) {
          balance += base.coins;
          ledger.push({
            userId: user.id,
            amount: base.coins,
            reason: "DAILY_STREAK",
            balanceAfter: balance,
          });
        }

        if (bonusCoins > 0) {
          balance += bonusCoins;
          ledger.push({
            userId: user.id,
            amount: bonusCoins,
            reason: "ACHIEVEMENT",
            balanceAfter: balance,
          });
        }

        if (ledger.length > 0) {
          await tx.coinTransaction.createMany({ data: ledger });
        }

        await tx.user.update({
          where: { id: user.id },
          data: { experience, level: levelAfter, coins: balance },
        });

        return {
          claimed: true,
          current: streak.current,
          best: streak.best,
          day: today,
          reward: { xp, coins: base.coins + bonusCoins },
          levelBefore: wallet.level,
          levelAfter,
          coins: balance,
          unlocked,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.claimed) {
      await invalidateCache("leaderboard");
    }

    return result;
  } catch (error) {
    if (isSerializationFailure(error)) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request changed your balance at the same time. Try again.",
      );
    }
    throw error;
  }
}
