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
  async ({ event }) => {
    const { email, user_id } = event.data;

    await email.send("weekly_digest", email, user_id);
  },
);

export const functions = [sendWeeklyDigest, prepareWeeklyDigest];
