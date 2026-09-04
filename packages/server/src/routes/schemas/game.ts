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
    startFen: z.string().nullable().openapi({ example: null }),
    difficulty: difficultySchema.nullable(),
    personality: personalitySchema.nullable().openapi({ example: null }),
    opponent: z
      .object({
        username: z.string(),
        title: z.string().nullable(),
      })
      .nullable()
      .openapi({ example: null }),
    yourColor: colorSchema,
    fen: z.string(),
    turn: colorSchema,
    status: gameStatusSchema,
    ply: z.number().int(),
    legalMoves: z.array(moveSchema),
    history: z.array(z.string()).openapi({ example: ["e4", "e5"] }),
    captured: z.object({
      byWhite: z.array(z.string()),
      byBlack: z.array(z.string()),
    }),
    materialBalance: z.number().int(),
    result: gameResultSchema.nullable(),
    timeControl: timeControlSchema.nullable().openapi({ example: null }),
    clock: clockSchema.nullable().openapi({ example: null }),
    drawOfferFrom: colorSchema.nullable().openapi({ example: null }),
    takebackOfferFrom: colorSchema.nullable().openapi({ example: null }),
    takebacks: z.number().int().openapi({ example: 0 }),
    chat: z.array(chatMessageSchema),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    rewards: rewardSchema.nullable(),
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
    title: z.string().nullable(),
  })
  .openapi("PlayerFace");

export const spectatorGameSchema = z
  .object({
    id: z.string(),
    white: playerFaceSchema.nullable(),
    black: playerFaceSchema.nullable(),
    variant: gameVariantSchema,
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
    drawOfferFrom: colorSchema.nullable().openapi({ example: null }),
    takebackOfferFrom: colorSchema.nullable().openapi({ example: null }),
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
    personality: personalitySchema,
    color: z.enum(["white", "black", "random"]).default("random"),
    timeControl: timeControlKeySchema.nullish(),
    variant: gameVariantSchema.default("STANDARD"),
  })
  .openapi("CreateGame");

export const queueJoinSchema = z
  .object({
    timeControl: timeControlKeySchema.nullish(),
  })
  .openapi("QueueJoin");

export const playMoveSchema = z
  .object({
    from: z.string().regex(SQUARE).openapi({ example: "e2" }),
    to: z.string().regex(SQUARE).openapi({ example: "e4" }),
    promotion: promotionSchema.optional(),
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

export const queueResultSchema = z
  .object({
    status: z.enum(["waiting", "matched"]),
    game: gameSchema.nullable(),
  })
  .openapi("QueueResult");
