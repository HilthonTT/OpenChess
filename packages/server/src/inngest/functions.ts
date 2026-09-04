import { Prisma } from "@openchess/database";
import { db } from "@openchess/database/client";

import {
  hasActiveSubscription,
  listActiveSubscriberExternalIds,
} from "../lib/polar";
import { isoWeekKey } from "./period";
import { inngest } from ".";

const PREMIUM_WEEKLY_COINS = 100;

const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

export const preparePremiumCoinAwards = inngest.createFunction(
  {
    id: "prepare-premium-coin-awards",
    triggers: { cron: "TZ=Europe/Paris 0 9 * * 1" },
  },
  async ({ step }) => {
    const plan = await step.run("plan-awards", async () => {
      const userIds = await listActiveSubscriberExternalIds();

      return {
        userIds,
        period: isoWeekKey(new Date()),
      };
    });

    if (plan.userIds.length === 0) {
      return { queued: 0 };
    }

    await step.sendEvent(
      "send-award-events",
      plan.userIds.map((userId) => ({
        id: `premium-coins-${userId}-${plan.period}`,
        name: "app/award.premium.coins",
        data: { user_id: userId, period: plan.period },
      })),
    );

    return { queued: plan.userIds.length, period: plan.period };
  },
);

export const awardPremiumCoins = inngest.createFunction(
  {
    id: "award-premium-coins",
    triggers: { event: "app/award.premium.coins" },
  },
  async ({ event, step, logger }) => {
    const { user_id, period } = event.data as {
      user_id: string;
      period?: string;
    };

    const periodKey =
      period ??
      (await step.run("resolve-period", () => isoWeekKey(new Date())));

    const premium = await step.run("check-premium", () =>
      hasActiveSubscription(user_id),
    );

    if (!premium) {
      return { user_id, period: periodKey, premium: false, awarded: 0 };
    }

    const awarded = await step.run("award-coins", async () => {
      try {
        return await db.$transaction(
          async (tx) => {
            const user = await tx.user.findUnique({ where: { id: user_id } });

            if (!user) {
              return 0;
            }

            const alreadyPaid = await tx.coinTransaction.findFirst({
              where: { userId: user.id, reason: "ADMIN_GRANT", periodKey },
              select: { id: true },
            });

            if (alreadyPaid) {
              return 0;
            }

            const balanceAfter = user.coins + PREMIUM_WEEKLY_COINS;

            await tx.coinTransaction.create({
              data: {
                userId: user.id,
                amount: PREMIUM_WEEKLY_COINS,
                reason: "ADMIN_GRANT",
                periodKey,
                balanceAfter,
              },
            });

            await tx.user.update({
              where: { id: user.id },
              data: { coins: balanceAfter },
            });

            return PREMIUM_WEEKLY_COINS;
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          return 0;
        }
        throw error;
      }
    });

    logger.info(
      { user_id, period: periodKey, awarded },
      awarded > 0 ? "premium stipend granted" : "premium stipend already paid",
    );

    return { user_id, period: periodKey, premium: true, awarded };
  },
);

export const functions = [preparePremiumCoinAwards, awardPremiumCoins];
