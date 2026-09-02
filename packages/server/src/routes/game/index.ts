import * as HttpStatusCodes from "stoker/http-status-codes";

import type { User } from "@openchess/database";

import { createRematch } from "../../game/challenges";
import {
  attachChat,
  attachSpectatorChat,
  sendChatMessage,
} from "../../game/chat";
import {
  abortGame,
  acceptDraw,
  acceptTakeback,
  claimVictory,
  createAiGame,
  declineDraw,
  declineTakeback,
  flagGame,
  getGame,
  getGamePgn,
  joinPvpQueue,
  leavePvpQueue,
  listActiveGames,
  listGames,
  listLiveGames,
  offerDraw,
  offerTakeback,
  playMove,
  resignGame,
  watchGame,
  type GameView,
} from "../../game/service";
import { createPlayerRouter } from "../../lib/create-app";
import {
  API_PATHS,
  pageLinks,
  withChallengeLinks,
  withGameLinks,
  withGameSummaryLinks,
  withLiveGameLinks,
} from "../../lib/hateoas";
import { rateLimit } from "../../middlewares/rate-limit";
import { requireAuth } from "../../middlewares/require-auth";
import { requireUser } from "../../middlewares/require-user";
import { decodeCursor } from "../schemas";

import {
  abort,
  acceptDrawRoute,
  acceptTakebackRoute,
  active,
  chat,
  claim,
  create,
  declineDrawRoute,
  declineTakebackRoute,
  flag,
  list,
  live,
  move,
  offerDrawRoute,
  pgn,
  queueJoin,
  queueLeave,
  read,
  rematch,
  resign,
  spectatorChat,
  takebackRoute,
  watch,
} from "./definitions";
import { streamGameState } from "./stream";

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

/**
 * A game as every 200 that carries one renders it: the transcript hung on, then
 * the links.
 *
 * One helper rather than the two calls spelled out at fourteen call sites,
 * because the failure mode of forgetting one is not a compile error — it is a
 * response whose `chat` is missing and a client that blanks its own message log
 * the moment you play a move.
 */
async function gameBody(game: GameView, user: User) {
  return withGameLinks(await attachChat(game, user));
}

/** The players' feed: the same body as `GET /games/{id}`, pushed. */
base.get("/:id/events", (c) => {
  const gameId = c.req.param("id");
  const user = c.get("user");

  return streamGameState(
    c,
    gameId,
    async () => gameBody(await getGame(gameId, user), user),
    // The last message's id rather than the count: the transcript is a window
    // onto the most recent few, so once it is full the count stops moving while
    // the conversation carries on.
    (state) =>
      [
        state.ply,
        state.result,
        state.drawOfferFrom,
        state.takebackOfferFrom,
        state.chat.at(-1)?.id ?? "",
      ].join("|"),
  );
});

/**
 * The spectators' feed: the same body as `GET /games/{id}/watch`, pushed.
 *
 * Sharing the loop with the players' stream is what keeps a watcher from ever
 * being a tick behind them — both wake on the same notification — and it is
 * also why a spectator never sees a legal-move list: the shape is decided by
 * `watchGame`, which has none to give. The `chat` hung on it afterwards is the
 * gallery's own, read from its own scope; the players' conversation has no path
 * onto this feed at all.
 */
base.get("/:id/watch/events", (c) => {
  const gameId = c.req.param("id");
  const user = c.get("user");

  return streamGameState(
    c,
    gameId,
    async () => attachSpectatorChat(await watchGame(gameId), user),
    // The chat term here is the *gallery's* last message, never the players'.
    // A message the players send still bumps the change counter and wakes this
    // stream, which then finds the same signature and correctly says nothing —
    // which is exactly the behaviour that keeps their conversation off this
    // feed even under a counter the two of them share.
    (state) =>
      [
        state.ply,
        state.result,
        state.drawOfferFrom,
        state.takebackOfferFrom,
        state.chat.at(-1)?.id ?? "",
      ].join("|"),
  );
});

// Chained rather than registered as separate statements: `.openapi()` returns a
// router carrying the new route in its type, so only the chained value knows the
// full shape. That type is what `hc<AppType>` builds the typed CLI client from.
const router = base
  .openapi(create, async (c) => {
    const { personality, color, timeControl, variant } = c.req.valid("json");

    const game = await createAiGame({
      user: c.get("user"),
      personality,
      color,
      timeControl: timeControl ?? null,
      variant,
    });

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.CREATED);
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
        game: result.game ? await gameBody(result.game, c.get("user")) : null,
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

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(watch, async (c) => {
    const { id } = c.req.valid("param");

    const game = await watchGame(id);

    return c.json(
      await attachSpectatorChat(game, c.get("user")),
      HttpStatusCodes.OK,
    );
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
      { ...result, state: await gameBody(result.state, c.get("user")) },
      HttpStatusCodes.OK,
    );
  })
  .openapi(resign, async (c) => {
    const { id } = c.req.valid("param");

    const game = await resignGame(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(offerDrawRoute, async (c) => {
    const { id } = c.req.valid("param");

    const game = await offerDraw(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(acceptDrawRoute, async (c) => {
    const { id } = c.req.valid("param");

    const game = await acceptDraw(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(declineDrawRoute, async (c) => {
    const { id } = c.req.valid("param");

    const game = await declineDraw(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(takebackRoute, async (c) => {
    const { id } = c.req.valid("param");

    const game = await offerTakeback(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(acceptTakebackRoute, async (c) => {
    const { id } = c.req.valid("param");

    const game = await acceptTakeback(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(declineTakebackRoute, async (c) => {
    const { id } = c.req.valid("param");

    const game = await declineTakeback(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(claim, async (c) => {
    const { id } = c.req.valid("param");

    const game = await claimVictory(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(flag, async (c) => {
    const { id } = c.req.valid("param");

    const game = await flagGame(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(abort, async (c) => {
    const { id } = c.req.valid("param");

    const game = await abortGame(id, c.get("user"));

    return c.json(await gameBody(game, c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(chat, async (c) => {
    const { id } = c.req.valid("param");
    const { phrase } = c.req.valid("json");

    const messages = await sendChatMessage({
      gameId: id,
      user: c.get("user"),
      phrase,
      scope: "PLAYERS",
    });

    return c.json({ chat: messages }, HttpStatusCodes.OK);
  })
  .openapi(spectatorChat, async (c) => {
    const { id } = c.req.valid("param");
    const { phrase } = c.req.valid("json");

    const messages = await sendChatMessage({
      gameId: id,
      user: c.get("user"),
      phrase,
      scope: "SPECTATORS",
    });

    return c.json({ chat: messages }, HttpStatusCodes.OK);
  });

export default router;
