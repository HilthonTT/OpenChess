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

/**
 * The daily check-in.
 *
 * The rule for *when* a streak advances is pure and lives in
 * `@openchess/shared`; this is the IO half — read the row, ask the rule, and
 * write the day, the payout and the ledger together.
 *
 * Paying twice for one day is the only failure that would matter here, and it is
 * ruled out twice over: a conditional write claims the day only if it has not
 * already been claimed, and the transaction runs Serializable because the coin
 * balance is read and then written back absolutely, exactly as `purchaseTitle`
 * and the game payout do.
 */

const SERIALIZATION_FAILURE = "P2034";

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === SERIALIZATION_FAILURE
  );
}

export type CheckInResult = {
  /** True when this call is what claimed today, false when today was already in. */
  claimed: boolean;
  /** The run including today. */
  current: number;
  /** The longest run this player has ever had. */
  best: number;
  /** The UTC day this check-in was against, `YYYY-MM-DD`. */
  day: string;
  /** What today paid. Zeroes when there was nothing left to claim. */
  reward: { xp: number; coins: number };
  levelBefore: number;
  levelAfter: number;
  /** The wallet after the payout. */
  coins: number;
  unlocked: Unlocked[];
};

/**
 * Claim today for `user`, paying if it had not already been claimed.
 *
 * Safe to call on every sign-in and safe to call repeatedly: the second call of
 * a day reports the streak with `claimed: false` and pays nothing, which is why
 * the client can fire it without tracking whether it already has.
 */
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
            lastDay: stats.lastCheckInDay
              ? utcDay(stats.lastCheckInDay)
              : null,
          },
          today,
        );

        // Claim the day conditionally. The predicate is the idempotency key: a
        // row whose `lastCheckInDay` already stands at today (or, under a clock
        // that went backwards, beyond it) matches nothing and updates nothing,
        // so a duplicate request cannot reach the payout below.
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
          // Nothing owed. Report the streak as it stands rather than as this
          // request imagined it, so a same-day repeat still renders correctly.
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

        // Read the wallet inside the transaction: the copy on `user` was loaded
        // before the request and a game settling since would have moved both
        // figures out from under it.
        const wallet = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });

        const xp = base.xp + bonusXp;
        const experience = wallet.experience + xp;
        const levelAfter = levelFor(experience);

        // One ledger row per reason, as the game payout does. `gameId` is null
        // on both, and Postgres counts NULLs as distinct, so
        // `@@unique([userId, gameId, reason])` leaves daily rows unbounded
        // while still guarding the per-game ones.
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

    // XP moved, so the level-sorted board moved with it.
    if (result.claimed) {
      await invalidateCache("leaderboard");
    }

    return result;
  } catch (error) {
    // A concurrent spend or payout touched the same wallet. The client retries,
    // and the retry finds the day already claimed and reports it as such.
    if (isSerializationFailure(error)) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request changed your balance at the same time. Try again.",
      );
    }
    throw error;
  }
}
