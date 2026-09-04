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
    affordable: z.boolean(),
    equipped: z.boolean(),
    _links: titleLinksSchema,
  })
  .openapi("Title");

export const equipTitleSchema = z
  .object({
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
    currentLoginStreak: z.number().int(),
    topLoginStreak: z.number().int(),
    lastCheckInDay: z.string().nullable().openapi({ example: "2026-07-23" }),
    loginStreakAlive: z.boolean(),
    rating: z.number().int(),
  })
  .openapi("Stats");

export const ratingPointSchema = z
  .object({
    rating: z.number().int().openapi({ example: 1214 }),
    delta: z.number().int().openapi({ example: 14 }),
    gameId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("RatingPoint");

export const ratingHistorySchema = z
  .object({
    history: z.array(ratingPointSchema),
    startingRating: z.number().int().openapi({ example: 1200 }),
    current: z.number().int().openapi({ example: 1214 }),
    peak: z.number().int().nullable(),
  })
  .openapi("RatingHistory");

export const checkInSchema = z
  .object({
    claimed: z.boolean(),
    current: z.number().int().openapi({ example: 3 }),
    best: z.number().int().openapi({ example: 12 }),
    day: z.string().openapi({ example: "2026-07-23" }),
    reward: z.object({
      xp: z.number().int(),
      coins: z.number().int(),
    }),
    levelBefore: z.number().int(),
    levelAfter: z.number().int(),
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
    you: z.boolean(),
  })
  .openapi("LeaderboardEntry");
