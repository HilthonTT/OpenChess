import { z } from "@hono/zod-openapi";
import { MAX_REPERTOIRE_PLIES } from "@openchess/shared";

import { colorSchema } from "./primitives";

/**
 * A line in a player's repertoire, and when they next have to prove they still
 * know it. The scheduling numbers are SM-2's; `progression/repertoire.ts` in
 * @openchess/shared is where they are moved and what each one means.
 */
export const repertoireLineSchema = z
  .object({
    id: z.string(),
    eco: z.string().openapi({ example: "C50" }),
    name: z.string().openapi({ example: "Italian Game" }),
    /** The line in SAN, from the initial array. */
    moves: z.array(z.string()).openapi({ example: ["e4", "e5", "Nf3"] }),
    /** Whose moves you have to find. The other side is played for you. */
    side: colorSchema,
    /** How many of the moves are yours — what a drill asks, and what it pays on. */
    yourMoves: z.number().int(),
    ease: z.number(),
    intervalDays: z.number().int(),
    reviews: z.number().int(),
    lapses: z.number().int(),
    /** Consecutive clean drills. Any mistake sets it to zero. */
    streak: z.number().int(),
    dueAt: z.string(),
    lastReviewedAt: z.string().nullable().openapi({ example: null }),
    /** Whether it is due now, decided by the server's clock and not yours. */
    due: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("RepertoireLine");

export const addRepertoireLineSchema = z
  .object({
    eco: z.string().min(1).max(8).openapi({ example: "C50" }),
    name: z.string().min(1).max(80).openapi({ example: "Italian Game" }),
    /** SAN from the initial array, the form the opening book is written in. */
    moves: z
      .array(z.string().min(1).max(10))
      .min(1)
      .max(MAX_REPERTOIRE_PLIES)
      .openapi({ example: ["e4", "e5", "Nf3", "Nc6", "Bc4"] }),
    /** Which colour to train it from. */
    side: colorSchema,
  })
  .openapi("AddRepertoireLine");

export const reviewRepertoireLineSchema = z
  .object({
    /**
     * How many of your moves you got wrong. One is enough to fail the line —
     * an opening line is a sequence, and half of one is not half as useful.
     */
    mistakes: z.number().int().min(0).max(MAX_REPERTOIRE_PLIES),
    /** How long the drill took. Omit it and the line is graded `good`. */
    msSpent: z.number().int().min(0).max(3_600_000).optional(),
  })
  .openapi("ReviewRepertoireLine");

export const repertoireReviewResultSchema = z
  .object({
    line: repertoireLineSchema,
    grade: z.enum(["again", "good", "easy"]),
    /** XP earned, or null when the line was not due — drilling ahead is free. */
    reward: z
      .object({
        xp: z.number().int(),
        levelBefore: z.number().int(),
        levelAfter: z.number().int(),
      })
      .nullable(),
  })
  .openapi("RepertoireReviewResult");
