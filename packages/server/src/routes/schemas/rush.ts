import { z } from "@hono/zod-openapi";

import { unlockSchema } from "./primitives";
import { puzzleSchema } from "./puzzles";

export const rushModeSchema = z
  .enum(["THREE_MINUTE", "FIVE_MINUTE", "SURVIVAL"])
  .openapi({ example: "THREE_MINUTE" });

export const rushRewardSchema = z
  .object({
    xp: z.number().int(),
    coins: z.number().int(),
    levelBefore: z.number().int(),
    levelAfter: z.number().int(),
    unlocked: z.array(unlockSchema),
  })
  .openapi("PuzzleRushReward");

export const rushRunSchema = z
  .object({
    id: z.string(),
    mode: rushModeSchema,
    solved: z.number().int(),
    missed: z.number().int(),
    livesLeft: z.number().int().openapi({ example: 3 }),
    puzzle: puzzleSchema.nullable(),
    endsAt: z.string().nullable().openapi({ example: null }),
    endedAt: z.string().nullable().openapi({ example: null }),
    over: z.boolean(),
    rewards: rushRewardSchema.nullable(),
    best: z.number().int(),
  })
  .openapi("PuzzleRushRun");

export const rushMoveResultSchema = rushRunSchema
  .extend({
    outcome: z.enum(["continue", "solved", "wrong"]).nullable(),
    reply: z.string().nullable(),
    solution: z.array(z.string()).nullable(),
  })
  .openapi("PuzzleRushMoveResult");

export const rushStartSchema = z
  .object({ mode: rushModeSchema.default("THREE_MINUTE") })
  .openapi("StartPuzzleRush");

export const rushLeaderboardEntrySchema = z
  .object({
    rank: z.number().int(),
    username: z.string(),
    title: z.string().nullable(),
    solved: z.number().int(),
    achievedAt: z.string(),
  })
  .openapi("PuzzleRushLeaderboardEntry");

export const rushBestSchema = z
  .object({
    mode: rushModeSchema,
    best: z.number().int(),
    runs: z.number().int(),
  })
  .openapi("PuzzleRushBest");
