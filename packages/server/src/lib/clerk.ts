import { createClerkClient } from "@clerk/backend";

import env from "../env";

export const clerkClient = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  telemetry: { disabled: env.NODE_ENV === "test" },
});

export type ClerkProfile = {
  username: string | null;
  emailLocalPart: string | null;
};

export async function fetchClerkProfile(userId: string): Promise<ClerkProfile> {
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress ?? null;

    return {
      username: user.username ?? null,
      emailLocalPart: email?.split("@")[0] ?? null,
    };
  } catch {
    return { username: null, emailLocalPart: null };
  }
}
