import { Prisma } from "@openchess/database";
import { db } from "@openchess/database/client";

import {
  hasActiveSubscription,
  listActiveSubscriberExternalIds,
} from "../lib/polar";
import { isoWeekKey } from "./period";
import { inngest } from ".";

/** What a premium subscription pays out per week, in coins. */
const PREMIUM_WEEKLY_COINS = 100;

/** Postgres rejected a duplicate: this period is already on the ledger. */
const UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

/**
 * The weekly premium stipend, fan-out half.
 *
 * A Monday-morning cron lists Polar's active subscribers — a page per hundred,
 * not a `getStateExternal` call per user in the table — and emits one event
 * per subscriber; `awardPremiumCoins` re-checks and pays. Fanning out keeps
 * one slow or failing Polar call from stalling every other player's stipend,
 * and gives each award its own retry.
 *
 * Every event carries an explicit `id` keyed on user + period, so a rerun of the
 * cron deduplicates at the Inngest boundary rather than fanning out twice. That
 * is the cheap guard, not the real one: event ids only deduplicate within
 * Inngest's own window, and they say nothing about a *step* that is retried
 * after its work already committed. The period travels in the event body so
 * `awardPremiumCoins` can make the payout itself exactly-once.
 */
export const preparePremiumCoinAwards = inngest.createFunction(
  {
    id: "prepare-premium-coin-awards",
    triggers: { cron: "TZ=Europe/Paris 0 9 * * 1" },
  },
  async ({ step }) => {
    // The period is computed inside the step so a retried run keeps the one it
    // started with even if it crosses a week boundary.
    const plan = await step.run("plan-awards", async () => {
      // These are our own User.ids: checkout keys the Polar customer by them.
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

/**
 * The weekly premium stipend, payout half.
 *
 * `step.run` is at-least-once, not exactly-once: a step whose result never gets
 * back to Inngest — a crashed worker, a timed-out request, a dropped
 * connection — is retried, and the transaction it already committed is not
 * rolled back by that. So the ledger insert *is* the claim: it carries the
 * period, `@@unique([userId, reason, periodKey])` refuses a second row for it,
 * and the balance is written in the same transaction. A retry after a
 * successful commit therefore finds the period already paid and pays nothing,
 * instead of handing out a second hundred coins.
 *
 * The pre-check in front of it is not what makes this safe — the constraint
 * is. It is there so the ordinary retry costs a read rather than a rolled-back
 * transaction, and so `awarded: 0` is reported rather than inferred from an
 * error.
 */
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

    // An event queued by an older deploy carries no period. Naming the week it
    // is being handled in is the right reading — it is the week the cron fired
    // — and it keeps such an event idempotent rather than exempt.
    //
    // Through a step, because the function body re-runs from the top at every
    // step boundary: read straight off the wall clock, a run that resumed after
    // a retry across midnight on Sunday would come back naming the *next* week
    // and pay a second time. A memoized step gives every replay the answer the
    // first attempt got. Only reached when the event lacks a period, and that
    // depends on the event alone, so the step sequence stays deterministic.
    const periodKey =
      period ??
      (await step.run("resolve-period", () => isoWeekKey(new Date())));

    const premium = await step.run("check-premium", () =>
      // Polar customers are keyed by our own User.id (see billing/checkout).
      hasActiveSubscription(user_id),
    );

    if (!premium) {
      return { user_id, period: periodKey, premium: false, awarded: 0 };
    }

    const awarded = await step.run("award-coins", async () => {
      try {
        // Serializable for the same reason as purchases: this reads the balance
        // and writes an absolute new value, and must not race a concurrent game
        // payout or store purchase. A serialization failure throws, and Inngest
        // retries the step — which is safe precisely because of the claim below.
        return await db.$transaction(
          async (tx) => {
            const user = await tx.user.findUnique({ where: { id: user_id } });

            // Deleted between fan-out and now; nothing to pay.
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
                // The closest existing CoinReason: a grant from the system, not
                // earned in play. A dedicated PREMIUM reason needs a migration.
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
        // Two deliveries of the same event raced past each other's pre-check.
        // One of them inserted; this one did not, and the transaction it lost
        // rolled back whole, balance included. Nothing is owed.
        //
        // Caught out here rather than around the insert because a constraint
        // violation aborts the enclosing Postgres transaction: there is nothing
        // left to carry on with inside it.
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
