import { z } from "@hono/zod-openapi";
import {
  CHAT_PHRASE_IDS,
  PERSONALITY_ORDER,
  type ChatPhraseId,
  type PersonalityId,
} from "@openchess/shared";

import {
  challengeLinksSchema,
  friendLinksSchema,
  gameLinksSchema,
  playerLinksSchema,
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

/**
 * A phrase key from @openchess/shared's catalog — never free text. Enumerated
 * from that catalog rather than written out here, so adding a phrase cannot
 * leave the API refusing one the client offers.
 */
export const chatPhraseSchema = z
  .enum(CHAT_PHRASE_IDS as [ChatPhraseId, ...ChatPhraseId[]])
  .openapi({ example: "goodGame" });

export const chatMessageSchema = z
  .object({
    id: z.string(),
    /** The catalog key. The client renders it; the server never sends text. */
    phrase: chatPhraseSchema,
    /** True when you are the one who said it. */
    mine: z.boolean(),
    username: z.string(),
    createdAt: z.string(),
  })
  .openapi("ChatMessage");

export const sendChatSchema = z
  .object({ phrase: chatPhraseSchema })
  .openapi("SendChatMessage");

export const gameSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    variant: gameVariantSchema,
    /** The array the game began from, or null when it is the ordinary one.
     * Replaying `history` without it puts a shuffled game's moves on the wrong
     * pieces, so a client that rebuilds the board must honour it. */
    startFen: z.string().nullable().openapi({ example: null }),
    difficulty: difficultySchema.nullable(),
    /** Which bot is playing, in an AI game. Null in a PvP game, and on an AI
     * game recorded before the bots had names. */
    personality: personalitySchema.nullable().openapi({ example: null }),
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
    /**
     * The side with a draw offer standing, or null when none is. Compare it with
     * `yourColor`: your own offer is waiting on them, theirs is yours to answer.
     * Always null on a settled game.
     */
    drawOfferFrom: colorSchema.nullable().openapi({ example: null }),
    /**
     * What the two of you have said to each other, oldest last, capped at the
     * most recent few. Empty in an AI game. Only the two players ever see it —
     * it is not on the spectator view.
     */
    chat: z.array(chatMessageSchema),
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
    variant: gameVariantSchema,
    difficulty: difficultySchema.nullable(),
    personality: personalitySchema.nullable().openapi({ example: null }),
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
    variant: gameVariantSchema,
    /** The array it began from; see `Game.startFen`. */
    startFen: z.string().nullable().openapi({ example: null }),
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
    /** The side with a draw offer standing, or null when none is. */
    drawOfferFrom: colorSchema.nullable().openapi({ example: null }),
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
    variant: gameVariantSchema,
    timeControl: timeControlKeySchema.nullable(),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"]),
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
    /** Omit for an ordinary game. The array is dealt on acceptance. */
    variant: gameVariantSchema.default("STANDARD"),
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

/**
 * Where a player is, as far as anyone else can tell. Derived from when we last
 * heard from them, so it goes stale on its own rather than needing to be
 * cleared: `playing` is `online` plus an unfinished game, and `offline` is
 * simply silence for long enough.
 */
export const presenceSchema = z
  .object({
    state: z.enum(["playing", "online", "offline"]).openapi({
      example: "online",
    }),
    /** When they were last seen, or null for an account never seen. */
    lastSeenAt: z.string().nullable(),
  })
  .openapi("Presence");

export const friendshipStateSchema = z
  .enum(["self", "friends", "requestSent", "requestReceived", "none"])
  .openapi({ example: "none" });

export const friendSchema = z
  .object({
    /** The friendship row — what accept, decline and remove address. */
    id: z.string(),
    userId: z.string(),
    username: z.string(),
    /** The label of their equipped title, if any. */
    title: z.string().nullable(),
    rating: z.number().int(),
    level: z.number().int(),
    presence: presenceSchema,
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED"]),
    /** True when you are the one who asked. */
    outgoing: z.boolean(),
    createdAt: z.string(),
    _links: friendLinksSchema,
  })
  .openapi("Friend");

export const addFriendSchema = z
  .object({
    /** Who to ask. Matched case-insensitively, the way a name is typed. */
    username: z.string().min(3).max(32),
  })
  .openapi("AddFriend");

/** A `{username}` path segment, matched case-insensitively by the service. */
export const usernameParamsSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .openapi({ param: { name: "username", in: "path" }, example: "magnus" }),
});

export const playerSearchResultSchema = z
  .object({
    userId: z.string(),
    username: z.string(),
    title: z.string().nullable(),
    level: z.number().int(),
    rating: z.number().int(),
    presence: presenceSchema,
    /** How you stand with them, so a client knows what to offer. */
    friendship: friendshipStateSchema,
  })
  .openapi("PlayerSearchResult");

const profileGameSchema = z
  .object({
    id: z.string(),
    mode: z.enum(["AI", "PVP"]),
    /** The other player, or the bot they played. */
    opponent: z.string().nullable(),
    /** The result from this player's point of view. */
    outcome: z.enum(["win", "loss", "draw", "aborted"]),
    result: gameResultSchema,
    ply: z.number().int(),
    endedAt: z.string(),
  })
  .openapi("ProfileGame");

/**
 * Another player's profile.
 *
 * A strict subset of `/me`: what a player has made public by playing, and
 * nothing else. There is no wallet, no ledger and no account identity here, and
 * the omission is by projection rather than by redaction — see `profiles.ts`.
 */
export const publicProfileSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    title: z.string().nullable(),
    level: z.number().int(),
    experience: z.number().int(),
    xpIntoLevel: z.number().int(),
    xpToNextLevel: z.number().int(),
    rating: z.number().int(),
    /** Best ever, over all history. Null for a player with no rated games. */
    peakRating: z.number().int().nullable(),
    puzzleRating: z.number().int(),
    puzzlesSolved: z.number().int(),
    wins: z.number().int(),
    losses: z.number().int(),
    draws: z.number().int(),
    currentWinStreak: z.number().int(),
    topWinStreak: z.number().int(),
    topLoginStreak: z.number().int(),
    achievementsUnlocked: z.number().int(),
    /** Newest first. Secret achievements are counted above but never named. */
    recentAchievements: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        unlockedAt: z.string(),
      }),
    ),
    /** The rating curve, oldest first, ready to plot. */
    ratingHistory: z.array(z.number().int()),
    recentGames: z.array(profileGameSchema),
    presence: presenceSchema,
    friendship: z.object({
      state: friendshipStateSchema,
      /** The row to accept, decline or remove, when there is one. */
      friendshipId: z.string().nullable(),
    }),
    joinedAt: z.string(),
    _links: playerLinksSchema,
  })
  .openapi("PublicProfile");

export const createGameSchema = z
  .object({
    /** Which bot to play. Its tier — and so what beating it pays — is the
     * server's to read off the catalog, not the client's to claim. */
    personality: personalitySchema,
    color: z.enum(["white", "black", "random"]).default("random"),
    /** Omit or pass null for an untimed game. */
    timeControl: timeControlKeySchema.nullish(),
    /** Omit for an ordinary game. */
    variant: gameVariantSchema.default("STANDARD"),
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
    /** The score. */
    solved: z.number().int(),
    missed: z.number().int(),
    livesLeft: z.number().int().openapi({ example: 3 }),
    /** The puzzle to solve now; null once the run is over. */
    puzzle: puzzleSchema.nullable(),
    /** When the clock stops it; null on a survival run. */
    endsAt: z.string().nullable().openapi({ example: null }),
    endedAt: z.string().nullable().openapi({ example: null }),
    over: z.boolean(),
    /** Present only on the response that ends the run. */
    rewards: rushRewardSchema.nullable(),
    /** Your best at this mode, this run included. */
    best: z.number().int(),
  })
  .openapi("PuzzleRushRun");

export const rushMoveResultSchema = rushRunSchema
  .extend({
    /** What the last move did; null when the run was already over. */
    outcome: z.enum(["continue", "solved", "wrong"]).nullable(),
    /** The forced reply, when the puzzle is not finished yet. UCI. */
    reply: z.string().nullable(),
    /** Revealed once the puzzle is done with, right or wrong. */
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
