import { z } from "@hono/zod-openapi";

import { friendLinksSchema, playerLinksSchema } from "../../lib/hateoas";

import { gameResultSchema } from "./primitives";

/**
 * Where a player is, as far as anyone else can tell. Derived from when we last
 * heard from them, so it goes stale on its own rather than needing to be
 * cleared: `playing` is `online` plus an unfinished game, and `offline` is
 * simply silence for long enough.
 */
export const presenceSchema = z
  .object({
    state: z.enum(["playing", "online", "offline"]).openapi({
      example: "online",
    }),
    /** When they were last seen, or null for an account never seen. */
    lastSeenAt: z.string().nullable(),
  })
  .openapi("Presence");

export const friendshipStateSchema = z
  .enum(["self", "friends", "requestSent", "requestReceived", "none"])
  .openapi({ example: "none" });

export const friendSchema = z
  .object({
    /** The friendship row — what accept, decline and remove address. */
    id: z.string(),
    userId: z.string(),
    username: z.string(),
    /** The label of their equipped title, if any. */
    title: z.string().nullable(),
    rating: z.number().int(),
    level: z.number().int(),
    presence: presenceSchema,
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED"]),
    /** True when you are the one who asked. */
    outgoing: z.boolean(),
    createdAt: z.string(),
    _links: friendLinksSchema,
  })
  .openapi("Friend");

export const addFriendSchema = z
  .object({
    /** Who to ask. Matched case-insensitively, the way a name is typed. */
    username: z.string().min(3).max(32),
  })
  .openapi("AddFriend");

export const playerSearchResultSchema = z
  .object({
    userId: z.string(),
    username: z.string(),
    title: z.string().nullable(),
    level: z.number().int(),
    rating: z.number().int(),
    presence: presenceSchema,
    /** How you stand with them, so a client knows what to offer. */
    friendship: friendshipStateSchema,
  })
  .openapi("PlayerSearchResult");

const profileGameSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    /** The other player, or the bot they played. */
    opponent: z.string().nullable(),
    /** The result from this player's point of view. */
    outcome: z.enum(["win", "loss", "draw", "aborted"]),
    result: gameResultSchema,
    ply: z.number().int(),
    endedAt: z.string(),
  })
  .openapi("ProfileGame");

/**
 * Another player's profile.
 *
 * A strict subset of `/me`: what a player has made public by playing, and
 * nothing else. There is no wallet, no ledger and no account identity here, and
 * the omission is by projection rather than by redaction — see `profiles.ts`.
 */
export const publicProfileSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    title: z.string().nullable(),
    level: z.number().int(),
    experience: z.number().int(),
    xpIntoLevel: z.number().int(),
    xpToNextLevel: z.number().int(),
    rating: z.number().int(),
    /** Best ever, over all history. Null for a player with no rated games. */
    peakRating: z.number().int().nullable(),
    puzzleRating: z.number().int(),
    puzzlesSolved: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    draws: z.number().int(),
    currentWinStreak: z.number().int(),
    topWinStreak: z.number().int(),
    topLoginStreak: z.number().int(),
    achievementsUnlocked: z.number().int(),
    /** Newest first. Secret achievements are counted above but never named. */
    recentAchievements: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        unlockedAt: z.string(),
      }),
    ),
    /** The rating curve, oldest first, ready to plot. */
    ratingHistory: z.array(z.number().int()),
    recentGames: z.array(profileGameSchema),
    presence: presenceSchema,
    friendship: z.object({
      state: friendshipStateSchema,
      /** The row to accept, decline or remove, when there is one. */
      friendshipId: z.string().nullable(),
    }),
    joinedAt: z.string(),
    _links: playerLinksSchema,
  })
  .openapi("PublicProfile");
