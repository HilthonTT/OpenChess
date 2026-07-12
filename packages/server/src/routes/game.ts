import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import {
  abortGame,
  createAiGame,
  getGame,
  listActiveGames,
  listGames,
  playMove,
  resignGame,
} from "../game/service";
import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  createGameSchema,
  idParamsSchema,
  gameResultSchema,
  gameSchema,
  gameSummarySchema,
  moveResultSchema,
  paginationQuerySchema,
  playMoveSchema,
} from "./schemas";

const router = createPlayerRouter();

// Every game route is a player action; none of them mean anything anonymously.
router.use("*", requireAuth, requireUser);

const TAGS = ["Games"];

const unauthorized = problemDetailsContent("Not authenticated");
const forbidden = problemDetailsContent("You are not a player in this game");
const notFound = problemDetailsContent("No such game");

const create = createRoute({
  tags: TAGS,
  method: "post",
  path: "/",
  summary: "Start an AI game",
  description:
    "When the bot draws white it plays its opening move before responding, so the board you get back is always yours to move on.",
  request: {
    body: jsonContentRequired(createGameSchema, "The game to start"),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent(gameSchema, "The new game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

router.openapi(create, async (c) => {
  const { difficulty, color } = c.req.valid("json");

  const game = await createAiGame({ user: c.get("user"), difficulty, color });

  return c.json(game, HttpStatusCodes.CREATED);
});

// Registered ahead of `/{id}` so the literal segment wins the match.
const active = createRoute({
  tags: TAGS,
  method: "get",
  path: "/active",
  summary: "Games still in progress",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ games: z.array(gameSummarySchema) }),
      "Unfinished games, newest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

router.openapi(active, async (c) => {
  const games = await listActiveGames(c.get("user"));

  return c.json({ games }, HttpStatusCodes.OK);
});

const list = createRoute({
  tags: TAGS,
  method: "get",
  path: "/",
  summary: "Your finished games",
  request: {
    query: paginationQuerySchema.extend({
      result: gameResultSchema.optional(),
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        games: z.array(gameSummarySchema),
        nextCursor: z.string().nullable(),
      }),
      "A page of finished games, newest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

router.openapi(list, async (c) => {
  const { cursor, limit, result } = c.req.valid("query");

  const page = await listGames({
    user: c.get("user"),
    limit,
    cursor: cursor ? new Date(cursor) : undefined,
    result,
  });

  return c.json(page, HttpStatusCodes.OK);
});

const read = createRoute({
  tags: TAGS,
  method: "get",
  path: "/{id}",
  summary: "The current position",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

router.openapi(read, async (c) => {
  const { id } = c.req.valid("param");

  const game = await getGame(id, c.get("user"));

  return c.json(game, HttpStatusCodes.OK);
});

const move = createRoute({
  tags: TAGS,
  method: "post",
  path: "/{id}/moves",
  summary: "Play a move",
  description:
    "Validates and applies your move, then plays the bot's reply in the same request. `ply` is the ply you last saw: if the board has moved on, the request is rejected as a conflict rather than played a second time.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(playMoveSchema, "The move to play"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      moveResultSchema,
      "Your move, the bot's reply, and the resulting position",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "The game is over, it is not your turn, or the board has moved on",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "The move is illegal or malformed",
    ),
  },
});

router.openapi(move, async (c) => {
  const { id } = c.req.valid("param");
  const { from, to, promotion, ply } = c.req.valid("json");

  const result = await playMove({
    gameId: id,
    user: c.get("user"),
    from,
    to,
    promotion,
    ply,
  });

  return c.json(result, HttpStatusCodes.OK);
});

const resign = createRoute({
  tags: TAGS,
  method: "post",
  path: "/{id}/resign",
  summary: "Resign",
  description:
    "Awards the win to the bot and settles the game. Resigning an already-finished game returns it unchanged rather than failing, so a retry is safe.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The settled game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

router.openapi(resign, async (c) => {
  const { id } = c.req.valid("param");

  const game = await resignGame(id, c.get("user"));

  return c.json(game, HttpStatusCodes.OK);
});

const abort = createRoute({
  tags: TAGS,
  method: "post",
  path: "/{id}/abort",
  summary: "Abort an unplayed game",
  description:
    "Only legal before the first move. Pays nothing and records no loss — the escape hatch for a misclicked game.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The aborted game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "The game is under way; resign it instead",
    ),
  },
});

router.openapi(abort, async (c) => {
  const { id } = c.req.valid("param");

  const game = await abortGame(id, c.get("user"));

  return c.json(game, HttpStatusCodes.OK);
});

export default router;
