import { Prisma } from "@openchess/database";
import { db } from "@openchess/database/client";

import {
  hasActiveSubscription,
  listActiveSubscriberExternalIds,
} from "../lib/polar";
import { inngest } from ".";

/** What a premium subscription pays out per week, in coins. */
const PREMIUM_WEEKLY_COINS = 100;

/**
 * The weekly premium stipend, fan-out half.
 *
 * A Monday-morning cron lists Polar's active subscribers — a page per hundred,
 * not a `getStateExternal` call per user in the table — and emits one event
 * per subscriber; `awardPremiumCoins` re-checks and pays. Fanning out keeps
 * one slow or failing Polar call from stalling every other player's stipend,
 * and gives each award its own retry.
 *
 * Every event carries an explicit `id` keyed on user + run date, so a rerun of
 * the cron the same day deduplicates at the Inngest boundary instead of paying
 * twice.
 */
export const preparePremiumCoinAwards = inngest.createFunction(
  {
    id: "prepare-premium-coin-awards",
    triggers: { cron: "TZ=Europe/Paris 0 9 * * 1" },
  },
  async ({ step }) => {
    // The date is computed inside the step so a retried run keeps the ids it
    // started with even if it crosses midnight.
    const plan = await step.run("plan-awards", async () => {
      // These are our own User.ids: checkout keys the Polar customer by them.
      const userIds = await listActiveSubscriberExternalIds();

      return {
        userIds,
        period: new Date().toISOString().slice(0, 10),
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
        data: { user_id: userId },
      })),
    );

    return { queued: plan.userIds.length };
  },
);

export const awardPremiumCoins = inngest.createFunction(
  {
    id: "award-premium-coins",
    triggers: { event: "app/award.premium.coins" },
  },
  async ({ event, step, logger }) => {
    const { user_id } = event.data;

    const premium = await step.run("check-premium", () =>
      // Polar customers are keyed by our own User.id (see billing/checkout).
      hasActiveSubscription(user_id),
    );

    if (!premium) {
      return { user_id, premium: false, awarded: 0 };
    }

    const awarded = await step.run("award-coins", () =>
      // Serializable for the same reason as purchases: this reads the balance
      // and writes an absolute new value, and must not race a concurrent game
      // payout or store purchase. A serialization failure throws, and Inngest
      // retries the step.
      db.$transaction(
        async (tx) => {
          const user = await tx.user.findUnique({ where: { id: user_id } });

          // Deleted between fan-out and now; nothing to pay.
          if (!user) {
            return 0;
          }

          const balanceAfter = user.coins + PREMIUM_WEEKLY_COINS;

          await tx.coinTransaction.create({
            data: {
              userId: user.id,
              amount: PREMIUM_WEEKLY_COINS,
              // The closest existing CoinReason: a grant from the system, not
              // earned in play. A dedicated PREMIUM reason needs a migration.
              reason: "ADMIN_GRANT",
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
      ),
    );

    logger.info({ user_id, awarded }, "premium stipend granted");

    return { user_id, premium: true, awarded };
  },
);

export const functions = [preparePremiumCoinAwards, awardPremiumCoins];
