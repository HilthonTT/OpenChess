import { z } from "@hono/zod-openapi";
import { MAX_REPERTOIRE_PLIES } from "@openchess/shared";

import { colorSchema } from "./primitives";

export const repertoireLineSchema = z
  .object({
    id: z.string(),
    eco: z.string().openapi({ example: "C50" }),
    name: z.string().openapi({ example: "Italian Game" }),
    moves: z.array(z.string()).openapi({ example: ["e4", "e5", "Nf3"] }),
    side: colorSchema,
    yourMoves: z.number().int(),
    ease: z.number(),
    intervalDays: z.number().int(),
    reviews: z.number().int(),
    lapses: z.number().int(),
    streak: z.number().int(),
    dueAt: z.string(),
    lastReviewedAt: z.string().nullable().openapi({ example: null }),
    due: z.boolean(),
    createdAt: z.string(),
  })
  .openapi("RepertoireLine");

export const addRepertoireLineSchema = z
  .object({
    eco: z.string().min(1).max(8).openapi({ example: "C50" }),
    name: z.string().min(1).max(80).openapi({ example: "Italian Game" }),
    moves: z
      .array(z.string().min(1).max(10))
      .min(1)
      .max(MAX_REPERTOIRE_PLIES)
      .openapi({ example: ["e4", "e5", "Nf3", "Nc6", "Bc4"] }),
    side: colorSchema,
  })
  .openapi("AddRepertoireLine");

export const reviewRepertoireLineSchema = z
  .object({
    mistakes: z.number().int().min(0).max(MAX_REPERTOIRE_PLIES),
    msSpent: z.number().int().min(0).max(3_600_000).optional(),
  })
  .openapi("ReviewRepertoireLine");

export const repertoireReviewResultSchema = z
  .object({
    line: repertoireLineSchema,
    grade: z.enum(["again", "good", "easy"]),
    reward: z
      .object({
        xp: z.number().int(),
        levelBefore: z.number().int(),
        levelAfter: z.number().int(),
      })
      .nullable(),
  })
  .openapi("RepertoireReviewResult");
