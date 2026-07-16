import { z } from "@hono/zod-openapi";

/**
 * The response and request shapes, registered with OpenAPI so the Scalar
 * reference at `/reference` documents them by name rather than inlining an
 * anonymous object at every use.
 */

export const SQUARE = /^[a-h][1-8]$/;

export const difficultySchema = z
  .enum(["EASY", "MEDIUM", "HARD"])
  .openapi({ example: "MEDIUM" });

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

export const gameSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    difficulty: difficultySchema.nullable(),
    yourColor: colorSchema,
    fen: z.string(),
    turn: colorSchema,
    status: gameStatusSchema,
    ply: z.number().int(),
    /** Empty unless it is your turn in a live game. */
    legalMoves: z.array(moveSchema),
    history: z.array(z.string()).openapi({ example: ["e4", "e5"] }),
    captured: z.object({
      byWhite: z.array(z.string()),
      byBlack: z.array(z.string()),
    }),
    materialBalance: z.number().int(),
    result: gameResultSchema.nullable(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    /** Present only on the response that ends the game. */
    rewards: rewardSchema.nullable(),
  })
  .openapi("Game");

export const gameSummarySchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    difficulty: difficultySchema.nullable(),
    yourColor: colorSchema,
    result: gameResultSchema.nullable(),
    ply: z.number().int(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
  })
  .openapi("GameSummary");

export const createGameSchema = z
  .object({
    difficulty: difficultySchema,
    color: z.enum(["white", "black", "random"]).default("random"),
  })
  .openapi("CreateGame");

export const playMoveSchema = z
  .object({
    from: z.string().regex(SQUARE).openapi({ example: "e2" }),
    to: z.string().regex(SQUARE).openapi({ example: "e4" }),
    promotion: promotionSchema.optional(),
    /**
     * The ply the client last saw. A mismatch means the board moved on — which
     * is how a retried request is recognized as a retry, rather than played as
     * a second move.
     */
    ply: z.number().int().min(0).openapi({ example: 0 }),
  })
  .openapi("PlayMove");

export const moveResultSchema = z
  .object({
    yourMove: moveSchema,
    aiMove: moveSchema.nullable(),
    state: gameSchema,
  })
  .openapi("MoveResult");

/** A cuid in the `{id}` path segment. Shared by every by-id route. */
export const idParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: "id", in: "path" },
      example: "clx0h2k9r0000abcd1234efgh",
    }),
});

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
  })
  .openapi("Profile");

export const statsSchema = z
  .object({
    wins: z.number().int(),
    losses: z.number().int(),
    draws: z.number().int(),
    currentWinStreak: z.number().int(),
    topWinStreak: z.number().int(),
    rating: z.number().int(),
  })
  .openapi("Stats");

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
    reason: z.enum(["GAME_REWARD", "ACHIEVEMENT", "PURCHASE", "ADMIN_GRANT"]),
    gameId: z.string().nullable(),
    balanceAfter: z.number().int(),
    createdAt: z.string(),
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

/** A page of results, with the cursor to ask for the next one. */
export function pageSchema<T extends z.ZodTypeAny>(item: T, key: string) {
  return z.object({
    [key]: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const paginationQuerySchema = z.object({
  // Cursors are the `nextCursor` we handed out: an ISO timestamp. Anything
  // else would reach Prisma as an Invalid Date and blow up as a 500, when it
  // deserves the 400 this schema turns it into.
  cursor: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
