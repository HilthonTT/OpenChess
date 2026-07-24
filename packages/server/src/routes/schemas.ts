import { z } from "@hono/zod-openapi";

import {
  challengeLinksSchema,
  gameLinksSchema,
  profileLinksSchema,
  puzzleLinksSchema,
  selfLinksSchema,
  titleLinksSchema,
  transactionLinksSchema,
} from "../lib/hateoas";

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

export const gameSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    difficulty: difficultySchema.nullable(),
    /** The other human in a PvP game; null in an AI game. */
    opponent: z
      .object({
        username: z.string(),
        /** The label of their equipped title, if any. */
        title: z.string().nullable(),
      })
      .nullable()
      .openapi({ example: null }),
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
    /** The game's clock, or null when it is untimed. */
    timeControl: timeControlSchema.nullable().openapi({ example: null }),
    /** Live clock readings, or null when the game is untimed. */
    clock: clockSchema.nullable().openapi({ example: null }),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    /** Present only on the response that ends the game. */
    rewards: rewardSchema.nullable(),
    /** The requests this game supports right now. */
    _links: gameLinksSchema,
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
    _links: selfLinksSchema,
  })
  .openapi("GameSummary");

const playerFaceSchema = z
  .object({
    username: z.string(),
    /** The label of their equipped title, if any. */
    title: z.string().nullable(),
  })
  .openapi("PlayerFace");

/**
 * A game as a watcher sees it. No `yourColor`, no `legalMoves` and no rewards:
 * a spectator has none of those, and a shape that pretended otherwise would
 * invite a client to offer actions the server refuses.
 */
export const spectatorGameSchema = z
  .object({
    id: z.string(),
    white: playerFaceSchema.nullable(),
    black: playerFaceSchema.nullable(),
    fen: z.string(),
    turn: colorSchema,
    status: gameStatusSchema,
    ply: z.number().int(),
    history: z.array(z.string()).openapi({ example: ["e4", "e5"] }),
    captured: z.object({
      byWhite: z.array(z.string()),
      byBlack: z.array(z.string()),
    }),
    materialBalance: z.number().int(),
    result: gameResultSchema.nullable(),
    timeControl: timeControlSchema.nullable(),
    clock: clockSchema.nullable(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
  })
  .openapi("SpectatorGame");

export const liveGameSchema = z
  .object({
    id: z.string(),
    white: playerFaceSchema.nullable(),
    black: playerFaceSchema.nullable(),
    whiteRating: z.number().int().nullable(),
    blackRating: z.number().int().nullable(),
    ply: z.number().int(),
    timeControl: timeControlSchema.nullable(),
    startedAt: z.string(),
    _links: selfLinksSchema,
  })
  .openapi("LiveGame");

export const challengeColorSchema = z
  .enum(["WHITE", "BLACK", "RANDOM"])
  .openapi({ example: "RANDOM" });

export const challengeSchema = z
  .object({
    id: z.string(),
    /** The short code that admits anyone to an open challenge. */
    code: z.string().openapi({ example: "K7M2QP" }),
    /** True when you are the one who sent it. */
    outgoing: z.boolean(),
    challenger: z.object({
      username: z.string(),
      rating: z.number().int(),
      title: z.string().nullable(),
    }),
    /** Null on an open challenge, until someone takes it. */
    challenged: z.object({ username: z.string() }).nullable(),
    /** The colour the challenger asked for. */
    color: challengeColorSchema,
    timeControl: timeControlKeySchema.nullable(),
    status: z.enum([
      "PENDING",
      "ACCEPTED",
      "DECLINED",
      "CANCELLED",
      "EXPIRED",
    ]),
    /** The game it became, once accepted. */
    gameId: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string(),
    _links: challengeLinksSchema,
  })
  .openapi("Challenge");

export const createChallengeSchema = z
  .object({
    /**
     * Who to challenge. Omit for an open challenge, which anyone holding its
     * `code` can accept.
     */
    opponent: z.string().min(3).max(32).nullish(),
    color: challengeColorSchema.default("RANDOM"),
    /** Omit or pass null for an untimed game. */
    timeControl: timeControlKeySchema.nullish(),
  })
  .openapi("CreateChallenge");

export const challengeCodeParamsSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(12)
    .openapi({ param: { name: "code", in: "path" }, example: "K7M2QP" }),
});

export const createGameSchema = z
  .object({
    difficulty: difficultySchema,
    color: z.enum(["white", "black", "random"]).default("random"),
    /** Omit or pass null for an untimed game. */
    timeControl: timeControlKeySchema.nullish(),
  })
  .openapi("CreateGame");

export const queueJoinSchema = z
  .object({
    /** The clock to be matched on. Omit or null to queue for an untimed game. */
    timeControl: timeControlKeySchema.nullish(),
  })
  .openapi("QueueJoin");

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
    /** The bot's reply. Always null in a PvP game, or when your move ended it. */
    aiMove: moveSchema.nullable(),
    state: gameSchema,
  })
  .openapi("MoveResult");

/**
 * One poll of the matchmaking queue. `game` is present exactly when `status`
 * is `matched`; a discriminated pair kept as one shape so the client's typed
 * RPC call has a single 200 body to narrow on.
 */
export const queueResultSchema = z
  .object({
    status: z.enum(["waiting", "matched"]),
    game: gameSchema.nullable(),
  })
  .openapi("QueueResult");

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
    /** How many moves the solver has to find. */
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
  })
  .openapi("NextPuzzle");

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

/**
 * A page cursor is `<iso-timestamp>_<row-id>` — compound, because the sort
 * timestamp alone is not unique: a payout `createMany`s several ledger rows in
 * one instant, and a bare-timestamp cursor would skip the rest of that batch
 * at a page boundary. Opaque to clients, which round-trip `nextCursor`
 * verbatim; the list services build one and only `decodeCursor` splits one.
 */
const CURSOR_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z_[^_]+$/;

/** Split a cursor `paginationQuerySchema` has already validated. */
export function decodeCursor(cursor: string): { ts: Date; id: string } {
  const at = cursor.indexOf("_");
  return { ts: new Date(cursor.slice(0, at)), id: cursor.slice(at + 1) };
}

export const paginationQuerySchema = z.object({
  // Cursors are the `nextCursor` we handed out. Anything malformed — the wrong
  // shape, or an out-of-range timestamp like month 13 — would reach Prisma as
  // an Invalid Date and blow up as a 500, when it deserves the 400 this schema
  // turns it into.
  cursor: z
    .string()
    .regex(CURSOR_PATTERN)
    .refine((cursor) => !Number.isNaN(decodeCursor(cursor).ts.getTime()))
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const healthStatusSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    timestamp: z.string(),
    uptime: z.number(),
    dependencies: z
      .object({
        database: z.enum(["connected", "disconnected"]),
        redis: z.enum(["connected", "disconnected", "disabled"]),
      })
      .optional(),
  })
  .openapi("HealthStatus");
