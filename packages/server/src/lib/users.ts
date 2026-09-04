import { Prisma, type User } from "@openchess/database";
import { db } from "@openchess/database/client";

import { invalidateCache } from "./cache";
import { fetchClerkProfile } from "./clerk";

const MAX_USERNAME_ATTEMPTS = 5;

const USERNAME_PATTERN = /[^a-z0-9_-]/g;

function isUniqueViolation(error: unknown, field: string): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  const meta = error.meta as
    | {
        target?: unknown;
        driverAdapterError?: {
          cause?: { constraint?: { index?: string; fields?: string[] } };
        };
      }
    | undefined;

  if (Array.isArray(meta?.target)) {
    return meta.target.includes(field);
  }

  const constraint = meta?.driverAdapterError?.cause?.constraint;
  if (constraint?.fields) {
    return constraint.fields.includes(field);
  }

  return constraint?.index === `User_${field}_key`;
}

function suffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function sanitize(candidate: string): string | null {
  const cleaned = candidate.toLowerCase().replace(USERNAME_PATTERN, "");
  return cleaned.length >= 3 ? cleaned.slice(0, 24) : null;
}

export function normalizeUsername(typed: string): string {
  return typed.trim().toLowerCase();
}

async function baseUsername(clerkUserId: string): Promise<string> {
  const profile = await fetchClerkProfile(clerkUserId);

  const candidate = profile.username ? sanitize(profile.username) : null;

  return candidate ?? `player_${suffix()}`;
}

export async function getOrCreateUser(clerkUserId: string): Promise<User> {
  const existing = await db.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    return existing;
  }

  const base = await baseUsername(clerkUserId);

  for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
    const username = attempt === 0 ? base : `${base}_${suffix()}`;

    try {
      const created = await db.user.create({
        data: {
          clerkUserId,
          username,
          stats: { create: {} },
        },
      });

      await invalidateCache("leaderboard");

      return created;
    } catch (error) {
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
