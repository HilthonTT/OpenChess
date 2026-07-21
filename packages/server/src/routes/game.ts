import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import {
  abortGame,
  claimVictory,
  createAiGame,
  flagGame,
  getGame,
  joinPvpQueue,
  leavePvpQueue,
  listActiveGames,
  listGames,
  playMove,
  resignGame,
} from "../game/service";
import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  createGameSchema,
  decodeCursor,
  idParamsSchema,
  gameResultSchema,
  gameSchema,
  gameSummarySchema,
  moveResultSchema,
  paginationQuerySchema,
  playMoveSchema,
  queueJoinSchema,
  queueResultSchema,
} from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

// Every game route is a player action; none of them mean anything anonymously.
// The rate limit sits behind auth so it can key by user — creating a game and
// playing a move both run the engine, which is too expensive to hand out
// unmetered. 120/min is far beyond any human pace against a bot.
base.use(
  "*",
  requireAuth,
  requireUser,
  rateLimit({ windowMs: 60_000, max: 120 }),
);

const unauthorized = problemDetailsContent("Not authenticated");
const forbidden = problemDetailsContent("You are not a player in this game");
const notFound = problemDetailsContent("No such game");

const create = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/",
  summary: "Start an AI game",
  description:
    "When the bot draws white it plays its opening move before responding, so the board you get back is always yours to move on. Pass a `timeControl` to play on a clock — the bot is not clocked, so only your own flag can fall.",
  request: {
    body: jsonContentRequired(createGameSchema, "The game to start"),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent(gameSchema, "The new game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "You have too many unfinished games; finish or resign one first",
    ),
  },
});

// Registered ahead of `/{id}` so the literal segment wins the match.
const active = createRoute({
  tags: [TAGS.GAMES],
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

const queueJoin = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/pvp/queue",
  summary: "Find an online match",
  description:
    "Joins the matchmaking queue, or reports on a search already under way. Poll this every couple of seconds: each call is also the heartbeat that keeps you eligible for pairing, and a player who stops polling drops out of the queue on their own. You are only paired with someone who chose the same `timeControl`, so each clock is effectively its own queue. Returns `matched` with the game as soon as an opponent is found — or immediately, if you already have an unfinished online game to resume.",
  request: {
    body: jsonContentRequired(queueJoinSchema, "The clock to queue for"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      queueResultSchema,
      "Waiting, or matched with a game",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const queueLeave = createRoute({
  tags: [TAGS.GAMES],
  method: "delete",
  path: "/pvp/queue",
  summary: "Stop searching for a match",
  description:
    "Leaves the matchmaking queue. Safe to call when not in it; an existing game is unaffected. `left` is false when a match was already being made at that instant — the game will exist, and can be aborted before its first move.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ left: z.boolean() }),
      "No longer in the queue",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const list = createRoute({
  tags: [TAGS.GAMES],
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

const read = createRoute({
  tags: [TAGS.GAMES],
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

const move = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/moves",
  summary: "Play a move",
  description:
    "Validates and applies your move. In an AI game the bot's reply is played in the same request; in a PvP game `aiMove` is always null and your opponent's move arrives on their own request — poll the game to see it. `ply` is the ply you last saw: if the board has moved on, the request is rejected as a conflict rather than played a second time.",
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

const resign = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/resign",
  summary: "Resign",
  description:
    "Awards the win to your opponent — bot or human — and settles the game. Resigning an already-finished game returns it unchanged rather than failing, so a retry is safe.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The settled game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const claim = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/claim",
  summary: "Claim the win from an absent opponent",
  description:
    "Settles an online game as a win for you when your opponent has walked away: it must be their turn, and the game must not have advanced for five minutes. Rating, rewards and the ledger come out exactly as if they had resigned. Claiming an already-finished game returns it unchanged, so a retry is safe.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The settled game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "Not claimable: an AI game, your own turn, or the opponent's clock has not run out",
    ),
  },
});

const flag = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/flag",
  summary: "Settle a game on time",
  description:
    "Ends a timed game whose running clock has fallen. The server, not the caller, decides who flagged — it is always the side to move — so this settles as a loss for whoever ran out, whether that is your opponent (whose walk-away you are cashing in) or you (having sat past your own flag). Flagging an already-finished game returns it unchanged, so a retry is safe.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The settled game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "Not flaggable: the game is untimed, or there is still time on the running clock",
    ),
  },
});

const abort = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/abort",
  summary: "Abort an unplayed game",
  description:
    "Only legal before your own first move — in an AI game where the bot opened, its move does not count against you. Pays nothing and records no loss — the escape hatch for a misclicked game.",
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

// Chained rather than registered as separate statements: `.openapi()` returns a
// router carrying the new route in its type, so only the chained value knows the
// full shape. That type is what `hc<AppType>` builds the typed CLI client from.
const router = base
  .openapi(create, async (c) => {
    const { difficulty, color, timeControl } = c.req.valid("json");

    const game = await createAiGame({
      user: c.get("user"),
      difficulty,
      color,
      timeControl: timeControl ?? null,
    });

    return c.json(game, HttpStatusCodes.CREATED);
  })
  .openapi(active, async (c) => {
    const games = await listActiveGames(c.get("user"));

    return c.json({ games }, HttpStatusCodes.OK);
  })
  .openapi(queueJoin, async (c) => {
    const { timeControl } = c.req.valid("json");

    const result = await joinPvpQueue(c.get("user"), timeControl ?? null);

    return c.json(result, HttpStatusCodes.OK);
  })
  .openapi(queueLeave, async (c) => {
    const left = leavePvpQueue(c.get("user"));

    return c.json({ left }, HttpStatusCodes.OK);
  })
  .openapi(list, async (c) => {
    const { cursor, limit, result } = c.req.valid("query");

    const page = await listGames({
      user: c.get("user"),
      limit,
      cursor: cursor ? decodeCursor(cursor) : undefined,
      result,
    });

    return c.json(page, HttpStatusCodes.OK);
  })
  .openapi(read, async (c) => {
    const { id } = c.req.valid("param");

    const game = await getGame(id, c.get("user"));

    return c.json(game, HttpStatusCodes.OK);
  })
  .openapi(move, async (c) => {
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
  })
  .openapi(resign, async (c) => {
    const { id } = c.req.valid("param");

    const game = await resignGame(id, c.get("user"));

    return c.json(game, HttpStatusCodes.OK);
  })
  .openapi(claim, async (c) => {
    const { id } = c.req.valid("param");

    const game = await claimVictory(id, c.get("user"));

    return c.json(game, HttpStatusCodes.OK);
  })
  .openapi(flag, async (c) => {
    const { id } = c.req.valid("param");

    const game = await flagGame(id, c.get("user"));

    return c.json(game, HttpStatusCodes.OK);
  })
  .openapi(abort, async (c) => {
    const { id } = c.req.valid("param");

    const game = await abortGame(id, c.get("user"));

    return c.json(game, HttpStatusCodes.OK);
  });

export default router;
