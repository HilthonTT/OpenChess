import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import { pageLinksSchema } from "../../lib/hateoas";
import { problemDetailsContent } from "../../lib/problem-details";
import {
  challengeSchema,
  chatMessageSchema,
  createGameSchema,
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
  sendChatSchema,
  sendSpectatorChatSchema,
  spectatorGameSchema,
} from "../schemas";
import { TAGS } from "../tags";

const unauthorized = problemDetailsContent("Not authenticated");

const forbidden = problemDetailsContent("You are not a player in this game");

const notFound = problemDetailsContent("No such game");

export const create = createRoute({
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

export const active = createRoute({
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

export const queueJoin = createRoute({
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

export const queueLeave = createRoute({
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

export const list = createRoute({
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

export const read = createRoute({
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

export const move = createRoute({
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

export const resign = createRoute({
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

const drawNotAvailable = problemDetailsContent(
  "Not drawable by agreement: an AI game, or no offer of your opponent's to take",
);

export const offerDrawRoute = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/draw",
  summary: "Offer a draw",
  description:
    "Puts a draw offer on the game for your opponent to answer. Online games only — the bot does not negotiate. One offer stands at a time: re-offering your own is a no-op, and offering while your *opponent's* offer stands is agreement, which settles the game as a draw there and then. That is what makes two players pressing it at the same instant come out as a draw rather than as a deadlock. An offer survives your own next move and is declined by theirs.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      gameSchema,
      "The game, with your offer standing — or settled, if that agreed a draw",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: drawNotAvailable,
  },
});

export const acceptDrawRoute = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/draw/accept",
  summary: "Accept a draw offer",
  description:
    "Takes the draw your opponent offered and settles the game. Both sides are paid and rated as a draw, exactly as if the position had drawn itself. Accepting an already-finished game returns it unchanged, so a retry is safe; accepting your own offer, or one that no longer stands, is a conflict.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The drawn game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: drawNotAvailable,
  },
});

export const declineDrawRoute = createRoute({
  tags: [TAGS.GAMES],
  method: "delete",
  path: "/{id}/draw",
  summary: "Decline or withdraw a draw offer",
  description:
    "Clears the standing offer. One route for both readings because the game holds one offer and either player may end it: the offerer withdraws theirs, the opponent declines it. Idempotent — with no offer standing there is nothing to clear, and the game comes back as it is.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      gameSchema,
      "The game, with no offer on it",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const takebackNotAvailable = problemDetailsContent(
  "Nothing to take back: the game is over, it holds no move of yours, or there is no request of your opponent's to grant",
);

export const takebackRoute = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/takeback",
  summary: "Take back your last move",
  description:
    "Rewinds the board to your own turn — one ply when you have just moved, two once your opponent has replied. What that means depends on who you are playing.\n\nAgainst the bot it happens immediately: there is nobody to ask. The price is the game's reward — the first takeback voids it, and the game will pay no XP and no coins however it ends.\n\nAgainst a person it is a request, and works like a draw offer: one stands at a time, re-asking is a no-op, and asking while your *opponent's* request stands is agreement, which hands **them** their move back there and then. Unlike a draw offer it does not survive a move — any move, yours included, clears it, because a takeback names a position and playing on moves that position.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      gameSchema,
      "The rewound game, or the game with your request standing on it",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: takebackNotAvailable,
  },
});

export const acceptTakebackRoute = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/takeback/accept",
  summary: "Grant a takeback request",
  description:
    "Hands your opponent their move back and rewinds the board to their turn. Online games only — against the bot a takeback is taken, not granted. Granting your own request, or one that a move has since cleared, is a conflict.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(gameSchema, "The rewound game"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: takebackNotAvailable,
  },
});

export const declineTakebackRoute = createRoute({
  tags: [TAGS.GAMES],
  method: "delete",
  path: "/{id}/takeback",
  summary: "Refuse or withdraw a takeback request",
  description:
    "Clears the standing request. One route for both readings, as the draw's is: the asker withdraws theirs, the opponent refuses it. Idempotent — with nothing standing there is nothing to clear, and the game comes back as it is.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      gameSchema,
      "The game, with no request on it",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

export const claim = createRoute({
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

export const flag = createRoute({
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

export const live = createRoute({
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

export const watch = createRoute({
  tags: [TAGS.GAMES],
  method: "get",
  path: "/{id}/watch",
  summary: "Watch a game you are not in",
  description:
    "The spectator's view of an online game: both players, the position, the clock and the move list — but no legal moves and no colour of your own, because a watcher has neither. The `chat` here is the *gallery's*, not the players': what the two of them are saying to each other is not on this view at all. Only online games can be watched; an AI game is a private board.",
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

export const pgn = createRoute({
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

export const rematch = createRoute({
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

export const chat = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/chat",
  summary: "Say something to your opponent",
  description:
    "Sends one of the phrases in the shared catalog — `phrase` is a key like `goodGame`, never text of your own, which is what makes this safe without a moderation queue. Online games only, players only, and capped per player per game. Nobody watching the game ever sees a word of this: the gallery has its own channel at `/{id}/watch/chat`, and the two never meet. A settled game still takes messages: 'good game' comes after the result, and the players' event stream stays open for a minute and a half past the end so it lands. Returns the recent transcript with your message on it; your opponent gets the same over their stream.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(sendChatSchema, "What to say"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ chat: z.array(chatMessageSchema) }),
      "The recent messages, oldest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: forbidden,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "An AI game, or you have said your fill of this one",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "That is not a phrase in the catalog",
    ),
  },
});

export const spectatorChat = createRoute({
  tags: [TAGS.GAMES],
  method: "post",
  path: "/{id}/watch/chat",
  summary: "Say something to the other watchers",
  description:
    "The gallery's channel. Same shape as the players' — a `phrase` key from the shared catalog, never text of your own — and a different list of phrases, because a watcher is commenting rather than playing: `brilliant` and `closeOne` are here, `sorry` and `oops` are not. Strictly separate from the players' conversation in both directions: neither player sees a word said here, and nothing they say to each other appears here, because the two of them did not sign up to be heard by an audience and a crowd talking over a live game is a coaching channel with extra steps. A player in the game is refused outright — there is no seat that can speak in both. Online games only, and capped per watcher per game.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(sendSpectatorChatSchema, "What to say"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ chat: z.array(chatMessageSchema) }),
      "The recent messages, oldest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "You are playing this game — the players have their own channel",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "An AI game, or you have said your fill of this one",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "That is not a phrase a watcher can say",
    ),
  },
});

export const abort = createRoute({
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
