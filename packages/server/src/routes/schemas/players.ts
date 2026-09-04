import { z } from "@hono/zod-openapi";

import { friendLinksSchema, playerLinksSchema } from "../../lib/hateoas";

import { gameResultSchema } from "./primitives";

export const presenceSchema = z
  .object({
    state: z.enum(["playing", "online", "offline"]).openapi({
      example: "online",
    }),
    lastSeenAt: z.string().nullable(),
  })
  .openapi("Presence");

export const friendshipStateSchema = z
  .enum(["self", "friends", "requestSent", "requestReceived", "none"])
  .openapi({ example: "none" });

export const friendSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    username: z.string(),
    title: z.string().nullable(),
    rating: z.number().int(),
    level: z.number().int(),
    presence: presenceSchema,
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED"]),
    outgoing: z.boolean(),
    createdAt: z.string(),
    _links: friendLinksSchema,
  })
  .openapi("Friend");

export const addFriendSchema = z
  .object({
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
    friendship: friendshipStateSchema,
  })
  .openapi("PlayerSearchResult");

const profileGameSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    opponent: z.string().nullable(),
    outcome: z.enum(["win", "loss", "draw", "aborted"]),
    result: gameResultSchema,
    ply: z.number().int(),
    endedAt: z.string(),
  })
  .openapi("ProfileGame");

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
    recentAchievements: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        unlockedAt: z.string(),
      }),
    ),
    ratingHistory: z.array(z.number().int()),
    recentGames: z.array(profileGameSchema),
    presence: presenceSchema,
    friendship: z.object({
      state: friendshipStateSchema,
      friendshipId: z.string().nullable(),
    }),
    joinedAt: z.string(),
    _links: playerLinksSchema,
  })
  .openapi("PublicProfile");
