import { createClerkClient } from "@clerk/backend";

import env from "../env";

/**
 * The Clerk client, and the profile read that goes with it.
 *
 * Deliberately not part of `lib/auth`: the tests replace that module wholesale
 * with `mock.module` to fake token verification, and anything else exported from
 * it would disappear along with the real implementation. Keeping the client here
 * lets `lib/auth` stay exactly one thing — "is this token good?" — and lets user
 * provisioning read a profile without being caught in the same mock.
 */
export const clerkClient = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
  // Required, not optional: for `oauth_token` Clerk asserts a *parseable*
  // publishable key before it will verify anything, and throws without one.
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
  telemetry: { disabled: env.NODE_ENV === "test" },
});

/** What Clerk knows about a user that we want to seed their local row with. */
export type ClerkProfile = {
  username: string | null;
  emailLocalPart: string | null;
};

/**
 * Read a user's profile from Clerk. Called once per user, when their local row
 * is first provisioned — an access token carries an id and nothing else, so a
 * display name has to be fetched.
 *
 * Never throws: a Clerk hiccup here should cost the user a nice username, not
 * their ability to start a game.
 */
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
