import { z } from "@hono/zod-openapi";

import { gameLinksSchema, selfLinksSchema } from "../../lib/hateoas";

import { chatMessageSchema } from "./chat";
import {
  SQUARE,
  clockSchema,
  colorSchema,
  difficultySchema,
  gameResultSchema,
  gameStatusSchema,
  gameVariantSchema,
  moveSchema,
  personalitySchema,
  promotionSchema,
  rewardSchema,
  timeControlKeySchema,
  timeControlSchema,
} from "./primitives";

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
     * The side with a takeback request standing, or null when none is. Read the
     * same way as `drawOfferFrom`. Always null on an AI game, where a takeback
     * is taken rather than asked for, and cleared by any move.
     */
    takebackOfferFrom: colorSchema.nullable().openapi({ example: null }),
    /**
     * How many moves have been taken back. Non-zero only on an AI game, and the
     * reason it will pay nothing when it ends.
     */
    takebacks: z.number().int().openapi({ example: 0 }),
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
    /** The side with a takeback request standing, or null when none is. */
    takebackOfferFrom: colorSchema.nullable().openapi({ example: null }),
    /**
     * What the *watchers* have said to each other, oldest last, capped at the
     * most recent few. Neither player ever sees it — it is not on the players'
     * view, and it is a different set of phrases besides.
     */
    chat: z.array(chatMessageSchema),
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
