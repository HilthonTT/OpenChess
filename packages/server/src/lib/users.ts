import { Prisma, type User } from "@openchess/database";
import { db } from "@openchess/database/client";

import { fetchClerkProfile } from "./clerk";

/**
 * Clerk owns identity; we own progression. The access token carries a Clerk user
 * id, but every foreign key in the schema — `Game.whitePlayerId`,
 * `CoinTransaction.userId` — points at our own `User.id`. This module is the
 * bridge, and it is where a local row gets created the first time we ever hear
 * from a given Clerk user.
 *
 * There is no signup endpoint and no Clerk webhook, so first-authenticated-
 * request *is* the provisioning event.
 */

/** Usernames are `@unique`; a collision has to be resolved, not surfaced. */
const MAX_USERNAME_ATTEMPTS = 5;

const USERNAME_PATTERN = /[^a-z0-9_-]/g;

function isUniqueViolation(error: unknown, field: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  // `meta.target` is the list of columns in the violated constraint.
  const target = error.meta?.target;
  return Array.isArray(target) && target.includes(field);
}

/** Four random base-36 characters: enough to break a collision, short enough to read. */
function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function sanitize(candidate: string): string | null {
  const cleaned = candidate.toLowerCase().replace(USERNAME_PATTERN, "");
  return cleaned.length >= 3 ? cleaned.slice(0, 24) : null;
}

/** Prefer what the user chose in Clerk, fall back to their email, then to noise. */
async function baseUsername(clerkUserId: string): Promise<string> {
  const profile = await fetchClerkProfile(clerkUserId);

  const candidate =
    (profile.username && sanitize(profile.username)) ??
    (profile.emailLocalPart && sanitize(profile.emailLocalPart));

  return candidate ?? `player_${suffix()}`;
}

/**
 * The local `User` for a Clerk id, creating it — with its `UserStats` — if this
 * is the first we have seen of them.
 */
export async function getOrCreateUser(clerkUserId: string): Promise<User> {
  const existing = await db.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    return existing;
  }

  const base = await baseUsername(clerkUserId);

  for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
    // The first try uses the name as-is; every retry disambiguates it.
    const username = attempt === 0 ? base : `${base}_${suffix()}`;

    try {
      return await db.user.create({
        data: {
          clerkUserId,
          username,
          // A user without stats would make every read of the leaderboard and
          // the reward pipeline null-check a row that should always exist.
          stats: { create: {} },
        },
      });
    } catch (error) {
      // Two concurrent first requests from the same user race here. The loser
      // reads back the winner's row rather than failing the request.
      if (isUniqueViolation(error, "clerkUserId")) {
        const winner = await db.user.findUnique({ where: { clerkUserId } });
        if (winner) {
          return winner;
        }
      }

      if (isUniqueViolation(error, "username")) {
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `Could not find a free username for Clerk user ${clerkUserId} after ${MAX_USERNAME_ATTEMPTS} attempts`,
  );
}
