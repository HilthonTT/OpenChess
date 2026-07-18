import { db } from "@openchess/database/client";
import { inngest } from ".";

// TODO: Have a cron job that awards premium members their coins, this is just for demo
export const prepareWeeklyDigest = inngest.createFunction(
  {
    id: "prepare-weekly-digest",
    triggers: { cron: "TZ=Europe/Paris 0 12 * * 5" },
  },
  async ({ step }) => {
    const users = await db.user.findMany();

    const events = users.map((user) => {
      return {
        name: "app/send.weekly.digest",
        data: {
          user_id: user.id,
          clerk_id: user.clerkUserId,
          username: user.username,
        },
      };
    });

    await step.sendEvent("send-digest-events", events);
  },
);

export const sendWeeklyDigest = inngest.createFunction(
  {
    id: "send-weekly-digest-email",
    triggers: { event: "app/send.weekly.digest" },
  },
  async ({ event, step, logger }) => {
    // Demo placeholder. The producer sends { user_id, clerk_id, username };
    // there is no email transport wired up yet, so record the intent instead
    // of calling one. (The previous version destructured a non-existent
    // `email` field and threw on every invocation.)
    const { user_id, username } = event.data;

    await step.run("record-digest", () => {
      logger.info({ user_id, username }, "weekly digest queued");
      return { user_id };
    });
  },
);

export const functions = [sendWeeklyDigest, prepareWeeklyDigest];
