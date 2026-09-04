import { z } from "@hono/zod-openapi";

import { puzzleLinksSchema } from "../../lib/hateoas";

import { SQUARE, unlockSchema } from "./primitives";

export const puzzleSchema = z
  .object({
    id: z.string(),
    fen: z.string(),
    openingMove: z.string().openapi({ example: "g2g4" }),
    rating: z.number().int().openapi({ example: 1100 }),
    themes: z.array(z.string()).openapi({ example: ["fork", "mateIn2"] }),
    sourceUrl: z.string().nullable(),
    solverMoves: z.number().int().openapi({ example: 2 }),
    attempted: z.boolean(),
    daily: z.boolean(),
    _links: puzzleLinksSchema,
  })
  .openapi("Puzzle");

export const nextPuzzleSchema = z
  .object({
    puzzle: puzzleSchema.nullable(),
    rating: z.number().int().openapi({ example: 1000 }),
    streak: z.number().int().openapi({ example: 3 }),
    theme: z.string().nullable().openapi({ example: null }),
  })
  .openapi("NextPuzzle");

export const puzzleThemeKeySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9]*$/)
  .openapi({ example: "fork" });

export const puzzleThemeSchema = z
  .object({
    key: puzzleThemeKeySchema,
    label: z.string().openapi({ example: "Fork" }),
    group: z.string().openapi({ example: "motif" }),
    trainable: z.boolean(),
    available: z.number().int(),
    attempted: z.number().int(),
    solved: z.number().int(),
  })
  .openapi("PuzzleTheme");

export const puzzleCollectionSchema = z
  .object({
    id: z.string().openapi({ example: "pins-20" }),
    name: z.string().openapi({ example: "Nailed down" }),
    description: z.string(),
    theme: puzzleThemeKeySchema,
    themeLabel: z.string().openapi({ example: "Pin" }),
    target: z.number().int(),
    solved: z.number().int(),
    available: z.number().int(),
    complete: z.boolean(),
    xpReward: z.number().int(),
    coinReward: z.number().int(),
    claimedAt: z.string().nullable().openapi({ example: null }),
  })
  .openapi("PuzzleCollection");

export const claimCollectionSchema = z
  .object({
    collection: puzzleCollectionSchema,
    reward: z
      .object({
        xp: z.number().int(),
        coins: z.number().int(),
        levelBefore: z.number().int(),
        levelAfter: z.number().int(),
      })
      .nullable(),
  })
  .openapi("ClaimedPuzzleCollection");

export const puzzleRewardSchema = z
  .object({
    xp: z.number().int(),
    coins: z.number().int(),
    levelBefore: z.number().int(),
    levelAfter: z.number().int(),
    ratingBefore: z.number().int(),
    ratingAfter: z.number().int(),
    streak: z.number().int(),
    unlocked: z.array(unlockSchema),
  })
  .openapi("PuzzleReward");

const solverMovesSchema = z
  .array(z.string().min(4).max(5))
  .max(64)
  .openapi({ example: ["d8h4"] });

export const puzzleSubmitSchema = z
  .object({
    moves: solverMovesSchema.min(1),
    hintUsed: z.boolean().optional(),
    msSpent: z.number().int().min(0).optional(),
  })
  .openapi("PuzzleSubmit");

export const puzzleRevealSchema = z
  .object({ moves: solverMovesSchema })
  .openapi("PuzzleReveal");

export const puzzleHintSchema = z
  .object({
    square: z.string().regex(SQUARE).openapi({ example: "d8" }),
  })
  .openapi("PuzzleHint");

export const puzzleMoveResultSchema = z
  .object({
    outcome: z.enum(["continue", "solved", "wrong"]),
    reply: z.string().nullable(),
    expected: z.string().nullable(),
    solution: z.array(z.string()).nullable(),
    rewards: puzzleRewardSchema.nullable(),
  })
  .openapi("PuzzleMoveResult");

export const puzzleAttemptSchema = z
  .object({
    puzzleId: z.string(),
    rating: z.number().int(),
    themes: z.array(z.string()),
    solved: z.boolean(),
    hintUsed: z.boolean(),
    ratingBefore: z.number().int(),
    ratingAfter: z.number().int(),
    xpAwarded: z.number().int(),
    coinsAwarded: z.number().int(),
    createdAt: z.string(),
  })
  .openapi("PuzzleAttempt");
