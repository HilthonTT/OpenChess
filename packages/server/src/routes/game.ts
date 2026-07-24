import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import { createRematch } from "../game/challenges";
import { gameVersion, subscribeToGame } from "../game/events";
import {
  abortGame,
  claimVictory,
  createAiGame,
  flagGame,
  getGame,
  getGamePgn,
  joinPvpQueue,
  leavePvpQueue,
  listActiveGames,
  listGames,
  listLiveGames,
  playMove,
  resignGame,
  watchGame,
} from "../game/service";
import { createPlayerRouter } from "../lib/create-app";
import type { PlayerEnv } from "../middlewares/require-user";
import {
  API_PATHS,
  pageLinks,
  pageLinksSchema,
  withChallengeLinks,
  withGameLinks,
  withGameSummaryLinks,
  withLiveGameLinks,
} from "../lib/hateoas";
import { problemDetailsContent } from "../lib/problem-details";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  challengeSchema,
  createGameSchema,
  decodeCursor,
  idParamsSchema,
  gameResultSchema,
  gameSchema,
  gameSummarySchema,
  liveGameSchema,
  moveResultSchema,
  paginationQuerySchema,
  playMoveSchema,
  queueJoinSchema,
  queueResultSchema,
  spectatorGameSchema,
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
        _links: pageLinksSchema,
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

// Registered ahead of `/{id}` so the literal segment wins the match.
const live = createRoute({
  tags: [TAGS.GAMES],
  method: "get",
  path: "/live",
  summary: "Games being played right now",
  description:
    "Online games with at least one move played, strongest first — the lower of the two ratings, so an even game outranks a mismatch. Anyone signed in can watch any of them.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ games: z.array(liveGameSchema) }),
      "Live games, best first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const watch = createRoute({
  tags: [TAGS.GAMES],
  method: "get",
  path: "/{id}/watch",
  summary: "Watch a game you are not in",
  description:
    "The spectator's view of an online game: both players, the position, the clock and the move list — but no legal moves and no colour of your own, because a watcher has neither. Only online games can be watched; an AI game is a private board.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(spectatorGameSchema, "The game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "Only online games can be watched",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const pgn = createRoute({
  tags: [TAGS.GAMES],
  method: "get",
  path: "/{id}/pgn",
  summary: "Download a finished game as PGN",
  description:
    "The archival PGN written when the game settled, with the players' names as they stood then. Served as `application/x-chess-pgn` with a filename, so a client can write it straight to disk.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: {
      description: "The PGN",
      content: {
        "application/x-chess-pgn": { schema: z.string() },
      },
    },
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "The game is not over yet",
    ),
  },
});

const rematch = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/rematch",
  summary: "Offer a rematch",
  description:
    "Sends the opponent of a finished online game a challenge for another one: same clock, colours swapped. It is an ordinary challenge from there — they accept it from their challenge list, and a repeated offer returns the one already standing rather than filling their inbox.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent(
      challengeSchema,
      "The rematch offer",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "Not rematchable: an AI game, one still going, or an opponent who is gone",
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

/**
 * How often a stream re-checks a game it has heard nothing about.
 *
 * A move made on *this* instance wakes the stream immediately, so this tick is
 * only the cross-instance path. Two seconds matches what the client used to poll
 * at, so a multi-instance deployment is never slower than it was — and on the
 * common path it is now as fast as the network allows.
 */
const REVALIDATE_MS = 2_000;

/**
 * A comment sent when nothing has happened, purely so idle connections stay
 * open. Proxies and load balancers cut streams that go quiet, and a chess game
 * can legitimately have nothing to say for minutes at a time.
 */
const KEEPALIVE_MS = 15_000;

/**
 * Wait for the game to change, or for the tick to elapse, whichever comes
 * first — and report which it was, because only a tick needs the version check
 * that follows it.
 */
function waitForChange(
  gameId: string,
  signal: AbortSignal,
): Promise<"changed" | "tick"> {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (reason: "changed" | "tick") => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(reason);
    };

    // An aborted request resolves as a tick; the loop then sees the abort on
    // its own condition and exits without touching the database.
    const onAbort = () => finish("tick");
    const unsubscribe = subscribeToGame(gameId, () => finish("changed"));
    const timer = setTimeout(() => finish("tick"), REVALIDATE_MS);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The live feed for one game, in whatever shape the caller is entitled to.
 *
 * Registered with `.get` rather than `.openapi` because the response is a
 * `text/event-stream` rather than a modelled JSON body — it is documented in the
 * README instead, and the CLI reads it with a plain fetch. Both streams still
 * sit behind the `requireAuth`/`requireUser` middleware above, and the loader
 * each one is given is the same authorization check the polling route makes, so
 * neither exposes anything the polling routes did not.
 *
 * Events are `state`, carrying exactly the JSON body of the matching GET. The
 * first one is sent immediately so a client needs no separate fetch to start,
 * and the stream closes itself once the game is over — there is nothing further
 * to report, and holding the connection open would only cost both ends.
 */
function streamGameState<T extends { ply: number; result: string | null }>(
  c: Context<PlayerEnv>,
  gameId: string,
  load: () => Promise<T>,
) {
  return streamSSE(c, async (stream) => {
    let lastPly = -1;
    let lastResult: string | null = null;
    let first = true;
    let knownVersion = await gameVersion(gameId);
    let quietSince = Date.now();

    const keepaliveIfQuiet = async () => {
      if (Date.now() - quietSince >= KEEPALIVE_MS) {
        await stream.write(": keepalive\n\n");
        quietSince = Date.now();
      }
    };

    while (!stream.aborted && !stream.closed) {
      const state = await load();

      // Resend only on a real change. A client holding a picked-up piece must
      // not have its selection cleared by an event that says nothing new.
      if (first || state.ply !== lastPly || state.result !== lastResult) {
        lastPly = state.ply;
        lastResult = state.result;
        first = false;
        quietSince = Date.now();

        await stream.writeSSE({
          event: "state",
          data: JSON.stringify(state),
        });
      } else {
        // Reached on every tick when Redis is absent (nothing to compare, so
        // each one reloads), and idle proxies still need bytes to flow.
        await keepaliveIfQuiet();
      }

      // A finished game has nothing left to say.
      if (state.result !== null) {
        break;
      }

      // Sit out quiet ticks here, without touching the database: only a moved
      // counter — or one we cannot read, where stale is the greater risk — is
      // worth paying for a reload.
      while (!stream.aborted && !stream.closed) {
        const reason = await waitForChange(gameId, c.req.raw.signal);

        if (stream.aborted || stream.closed) {
          break;
        }

        if (reason === "changed") {
          knownVersion = await gameVersion(gameId);
          break;
        }

        const version = await gameVersion(gameId);

        if (version === null || version !== knownVersion) {
          knownVersion = version;
          break;
        }

        await keepaliveIfQuiet();
      }
    }
  });
}

/** The players' feed: the same body as `GET /games/{id}`, pushed. */
base.get("/:id/events", (c) => {
  const gameId = c.req.param("id");
  const user = c.get("user");

  return streamGameState(c, gameId, async () =>
    withGameLinks(await getGame(gameId, user)),
  );
});

/**
 * The spectators' feed: the same body as `GET /games/{id}/watch`, pushed.
 *
 * Sharing the loop with the players' stream is what keeps a watcher from ever
 * being a tick behind them — both wake on the same notification — and it is
 * also why a spectator never sees a legal-move list: the shape is decided by
 * `watchGame`, which has none to give.
 */
base.get("/:id/watch/events", (c) => {
  const gameId = c.req.param("id");

  return streamGameState(c, gameId, () => watchGame(gameId));
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

    return c.json(withGameLinks(game), HttpStatusCodes.CREATED);
  })
  .openapi(active, async (c) => {
    const games = await listActiveGames(c.get("user"));

    return c.json(
      { games: games.map(withGameSummaryLinks) },
      HttpStatusCodes.OK,
    );
  })
  .openapi(live, async (c) => {
    const games = await listLiveGames();

    return c.json({ games: games.map(withLiveGameLinks) }, HttpStatusCodes.OK);
  })
  .openapi(queueJoin, async (c) => {
    const { timeControl } = c.req.valid("json");

    const result = await joinPvpQueue(c.get("user"), timeControl ?? null);

    return c.json(
      {
        status: result.status,
        game: result.game ? withGameLinks(result.game) : null,
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(queueLeave, async (c) => {
    const left = await leavePvpQueue(c.get("user"));

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

    return c.json(
      {
        games: page.games.map(withGameSummaryLinks),
        nextCursor: page.nextCursor,
        _links: pageLinks(
          API_PATHS.games,
          { cursor, limit, result },
          page.nextCursor,
        ),
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(read, async (c) => {
    const { id } = c.req.valid("param");

    const game = await getGame(id, c.get("user"));

    return c.json(withGameLinks(game), HttpStatusCodes.OK);
  })
  .openapi(watch, async (c) => {
    const { id } = c.req.valid("param");

    const game = await watchGame(id);

    return c.json(game, HttpStatusCodes.OK);
  })
  .openapi(pgn, async (c) => {
    const { id } = c.req.valid("param");

    const { pgn: text, filename } = await getGamePgn(id, c.get("user"));

    // `attachment` rather than `inline`: this is a file to save, and the CLI
    // reads the name off the header rather than inventing one.
    c.header("Content-Type", "application/x-chess-pgn; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${filename}"`);

    return c.body(text, HttpStatusCodes.OK);
  })
  .openapi(rematch, async (c) => {
    const { id } = c.req.valid("param");

    const challenge = await createRematch({ user: c.get("user"), gameId: id });

    return c.json(withChallengeLinks(challenge), HttpStatusCodes.CREATED);
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

    return c.json(
      { ...result, state: withGameLinks(result.state) },
      HttpStatusCodes.OK,
    );
  })
  .openapi(resign, async (c) => {
    const { id } = c.req.valid("param");

    const game = await resignGame(id, c.get("user"));

    return c.json(withGameLinks(game), HttpStatusCodes.OK);
  })
  .openapi(claim, async (c) => {
    const { id } = c.req.valid("param");

    const game = await claimVictory(id, c.get("user"));

    return c.json(withGameLinks(game), HttpStatusCodes.OK);
  })
  .openapi(flag, async (c) => {
    const { id } = c.req.valid("param");

    const game = await flagGame(id, c.get("user"));

    return c.json(withGameLinks(game), HttpStatusCodes.OK);
  })
  .openapi(abort, async (c) => {
    const { id } = c.req.valid("param");

    const game = await abortGame(id, c.get("user"));

    return c.json(withGameLinks(game), HttpStatusCodes.OK);
  });

export default router;
