import { z } from "@hono/zod-openapi";
import { PERSONALITY_ORDER, type PersonalityId } from "@openchess/shared";

export const SQUARE = /^[a-h][1-8]$/;

export const difficultySchema = z
  .enum(["EASY", "MEDIUM", "HARD"])
  .openapi({ example: "MEDIUM" });

/**
 * Which bot, by its id in @openchess/shared's catalog. Enumerated from that
 * catalog rather than written out here, so adding a bot cannot leave the API
 * refusing to let anyone play it.
 */
export const personalitySchema = z
  .enum(PERSONALITY_ORDER as [PersonalityId, ...PersonalityId[]])
  .openapi({ example: "maestro" });

export const gameVariantSchema = z
  .enum(["STANDARD", "CHESS960"])
  .openapi({ example: "STANDARD" });

export const colorSchema = z.enum(["w", "b"]).openapi({ example: "w" });

export const gameResultSchema = z.enum([
  "WHITE_WIN",
  "BLACK_WIN",
  "DRAW",
  "ABORTED",
]);

export const gameStatusSchema = z.enum([
  "playing",
  "check",
  "checkmate",
  "stalemate",
  "draw-fifty-move",
  "draw-repetition",
  "draw-insufficient-material",
]);

export const promotionSchema = z.enum(["q", "r", "b", "n"]);

export const timeControlKeySchema = z
  .enum(["bullet", "blitz", "rapid"])
  .openapi({ example: "blitz" });

export const timeControlSchema = z
  .object({
    initialSeconds: z.number().int().openapi({ example: 180 }),
    incrementSeconds: z.number().int().openapi({ example: 2 }),
  })
  .openapi("TimeControl");

export const clockSchema = z
  .object({
    /** Milliseconds left for each side as of the last committed move. */
    whiteMs: z.number().int(),
    blackMs: z.number().int(),
    /** When the running side's clock started; a reader ticks down from here. */
    turnStartedAt: z.string(),
    /** Whose clock is running. Only meaningful while the game is live. */
    running: colorSchema,
  })
  .openapi("Clock");

export const moveSchema = z
  .object({
    from: z.string().openapi({ example: "e2" }),
    to: z.string().openapi({ example: "e4" }),
    promotion: promotionSchema.nullable(),
    san: z.string().openapi({ example: "e4" }),
    uci: z.string().openapi({ example: "e2e4" }),
  })
  .openapi("Move");

export const unlockSchema = z
  .object({
    code: z.string().openapi({ example: "FIRST_WIN" }),
    name: z.string(),
    description: z.string(),
    xpReward: z.number().int(),
    coinReward: z.number().int(),
  })
  .openapi("AchievementUnlock");

export const rewardSchema = z
  .object({
    xp: z.number().int(),
    coins: z.number().int(),
    levelBefore: z.number().int(),
    levelAfter: z.number().int(),
    ratingBefore: z.number().int(),
    ratingAfter: z.number().int(),
    unlocked: z.array(unlockSchema),
  })
  .openapi("Reward");
