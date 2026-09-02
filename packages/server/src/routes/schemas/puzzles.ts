import { z } from "@hono/zod-openapi";

import { puzzleLinksSchema } from "../../lib/hateoas";

import { SQUARE, unlockSchema } from "./primitives";

/**
 * A puzzle as a solver may see it: the position, and the move that created the
 * tactic. The rest of the line is the answer and never leaves the server until
 * the puzzle is over.
 */
export const puzzleSchema = z
  .object({
    id: z.string(),
    fen: z.string(),
    /** The move that set the tactic up, already played on `fen`. UCI. */
    openingMove: z.string().openapi({ example: "g2g4" }),
    rating: z.number().int().openapi({ example: 1100 }),
    themes: z.array(z.string()).openapi({ example: ["fork", "mateIn2"] }),
    sourceUrl: z.string().nullable(),
    solverMoves: z.number().int().openapi({ example: 2 }),
    /** True when you have already been scored on this puzzle. */
    attempted: z.boolean(),
    daily: z.boolean(),
    _links: puzzleLinksSchema,
  })
  .openapi("Puzzle");

export const nextPuzzleSchema = z
  .object({
    /** Null when the catalog has nothing left to serve you. */
    puzzle: puzzleSchema.nullable(),
    rating: z.number().int().openapi({ example: 1000 }),
    streak: z.number().int().openapi({ example: 3 }),
    /** The theme this was filtered by, or null when it was not. */
    theme: z.string().nullable().openapi({ example: null }),
  })
  .openapi("NextPuzzle");

/**
 * A theme tag. Left as a free string rather than an enum of the catalog: the
 * tags come from whichever corpus was imported, and a fixed list here would
 * refuse a filter the database can perfectly well answer.
 */
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
    /** Whether it is worth offering as something to train on its own. */
    trainable: z.boolean(),
    /** How many puzzles in the corpus carry it. */
    available: z.number().int(),
    /** Your own record at it. */
    attempted: z.number().int(),
    solved: z.number().int(),
  })
  .openapi("PuzzleTheme");

export const puzzleCollectionSchema = z
  .object({
    id: z.string().openapi({ example: "pins-20" }),
    name: z.string().openapi({ example: "Nailed down" }),
    description: z.string(),
    /** The raw theme tag, ready to hand straight to the trainer. */
    theme: puzzleThemeKeySchema,
    /** What that theme is called, from the same catalog the trainer reads. */
    themeLabel: z.string().openapi({ example: "Pin" }),
    /** How many distinct puzzles carrying the theme finish it. */
    target: z.number().int(),
    solved: z.number().int(),
    /** How many the corpus holds at all — the target is fixed, this is not. */
    available: z.number().int(),
    complete: z.boolean(),
    xpReward: z.number().int(),
    coinReward: z.number().int(),
    /** When you took the reward, or null while it is still owed or unearned. */
    claimedAt: z.string().nullable().openapi({ example: null }),
  })
  .openapi("PuzzleCollection");

export const claimCollectionSchema = z
  .object({
    collection: puzzleCollectionSchema,
    /** The payout, or null when this claim repeated one already paid. */
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

/** Every solver move played on this puzzle so far, in order, newest last. */
const solverMovesSchema = z
  .array(z.string().min(4).max(5))
  .max(64)
  .openapi({ example: ["d8h4"] });

export const puzzleSubmitSchema = z
  .object({
    moves: solverMovesSchema.min(1),
    /** Whether you took a hint. The server's own record is honoured too. */
    hintUsed: z.boolean().optional(),
    /** How long the solve took, for the record. */
    msSpent: z.number().int().min(0).optional(),
  })
  .openapi("PuzzleSubmit");

export const puzzleRevealSchema = z
  .object({ moves: solverMovesSchema })
  .openapi("PuzzleReveal");

export const puzzleHintSchema = z
  .object({
    /** The square the piece to move stands on. */
    square: z.string().regex(SQUARE).openapi({ example: "d8" }),
  })
  .openapi("PuzzleHint");

export const puzzleMoveResultSchema = z
  .object({
    outcome: z.enum(["continue", "solved", "wrong"]),
    /** The opponent's forced reply, when the line continues. UCI. */
    reply: z.string().nullable(),
    /** The move that was wanted. Only ever sent once the puzzle is lost. */
    expected: z.string().nullable(),
    /** The solver's moves in SAN. Only sent once the puzzle is over. */
    solution: z.array(z.string()).nullable(),
    /** Null unless this request settled a puzzle that had not been attempted. */
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
