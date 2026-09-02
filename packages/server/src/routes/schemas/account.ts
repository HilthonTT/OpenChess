import { z } from "@hono/zod-openapi";

import {
  profileLinksSchema,
  titleLinksSchema,
  transactionLinksSchema,
} from "../../lib/hateoas";

import { unlockSchema } from "./primitives";

export const titleSchema = z
  .object({
    id: z.string(),
    code: z.string().openapi({ example: "GRANDMASTER" }),
    label: z.string().openapi({ example: "Grandmaster" }),
    description: z.string().nullable(),
    price: z.number().int(),
    rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]),
    requiredLevel: z.number().int(),
    isPurchasable: z.boolean(),
    owned: z.boolean(),
    /** Whether the caller can afford it *and* is high enough level. */
    affordable: z.boolean(),
    equipped: z.boolean(),
    /** What you can do with the title: buy it, or display it. */
    _links: titleLinksSchema,
  })
  .openapi("Title");

export const equipTitleSchema = z
  .object({
    /** Null clears the equipped title. */
    titleId: z.string().nullable(),
  })
  .openapi("EquipTitle");

export const profileSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    level: z.number().int(),
    experience: z.number().int(),
    xpIntoLevel: z.number().int(),
    xpToNextLevel: z.number().int(),
    coins: z.number().int(),
    equippedTitle: titleSchema
      .pick({ id: true, code: true, label: true, rarity: true })
      .nullable(),
    createdAt: z.string(),
    /** The rest of your account, one hop away. */
    _links: profileLinksSchema,
  })
  .openapi("Profile");

export const statsSchema = z
  .object({
    wins: z.number().int(),
    losses: z.number().int(),
    draws: z.number().int(),
    currentWinStreak: z.number().int(),
    topWinStreak: z.number().int(),
    /** Consecutive days checked in. Zero for a player who never has. */
    currentLoginStreak: z.number().int(),
    topLoginStreak: z.number().int(),
    /** The last day claimed, `YYYY-MM-DD` UTC, or null. */
    lastCheckInDay: z.string().nullable().openapi({ example: "2026-07-23" }),
    /**
     * Whether `currentLoginStreak` can still be extended — false once a day has
     * been missed and the next check-in will restart the run at one.
     */
    loginStreakAlive: z.boolean(),
    rating: z.number().int(),
  })
  .openapi("Stats");

export const ratingPointSchema = z
  .object({
    /** The rating after that game settled. */
    rating: z.number().int().openapi({ example: 1214 }),
    /** The change that produced it. Never zero — a point is a change. */
    delta: z.number().int().openapi({ example: 14 }),
    /** The game that moved it, or null if it has since been deleted. */
    gameId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("RatingPoint");

export const ratingHistorySchema = z
  .object({
    /**
     * Oldest first, so the array plots left to right. This is a window onto the
     * most recent `limit` changes and not a paginated list: a chart wants the
     * recent shape of the curve, and there is nothing to page back through.
     */
    history: z.array(ratingPointSchema),
    /**
     * Where the window opens — the rating before its first point, which is what
     * a chart needs to anchor its left edge. Equal to `current` when the history
     * is empty.
     */
    startingRating: z.number().int().openapi({ example: 1200 }),
    /** The rating now, straight off the stats row. */
    current: z.number().int().openapi({ example: 1214 }),
    /**
     * The highest rating ever reached, over all history rather than the window.
     * Null for a player who has never played a rated game.
     */
    peak: z.number().int().nullable(),
  })
  .openapi("RatingHistory");

export const checkInSchema = z
  .object({
    /** True when this request is what claimed the day. */
    claimed: z.boolean(),
    current: z.number().int().openapi({ example: 3 }),
    best: z.number().int().openapi({ example: 12 }),
    /** The UTC day claimed. */
    day: z.string().openapi({ example: "2026-07-23" }),
    /** What today paid, achievement bonuses included. Zeroes if already claimed. */
    reward: z.object({
      xp: z.number().int(),
      coins: z.number().int(),
    }),
    levelBefore: z.number().int(),
    levelAfter: z.number().int(),
    /** The wallet after the payout. */
    coins: z.number().int(),
    unlocked: z.array(unlockSchema),
  })
  .openapi("CheckIn");

export const achievementSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    description: z.string(),
    iconUrl: z.string().nullable(),
    xpReward: z.number().int(),
    coinReward: z.number().int(),
    secret: z.boolean(),
    unlockedAt: z.string().nullable(),
  })
  .openapi("Achievement");

export const transactionSchema = z
  .object({
    id: z.string(),
    amount: z.number().int().openapi({ example: -250 }),
    reason: z.enum([
      "GAME_REWARD",
      "ACHIEVEMENT",
      "PURCHASE",
      "ADMIN_GRANT",
      "PUZZLE",
      "PUZZLE_COLLECTION",
      "DAILY_STREAK",
    ]),
    gameId: z.string().nullable(),
    balanceAfter: z.number().int(),
    createdAt: z.string(),
    _links: transactionLinksSchema,
  })
  .openapi("CoinTransaction");

export const leaderboardEntrySchema = z
  .object({
    rank: z.number().int(),
    userId: z.string(),
    username: z.string(),
    level: z.number().int(),
    experience: z.number().int(),
    rating: z.number().int(),
    wins: z.number().int(),
    title: z.string().nullable(),
    /** True for the caller's own row. */
    you: z.boolean(),
  })
  .openapi("LeaderboardEntry");
