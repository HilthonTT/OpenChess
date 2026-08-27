import type { ChatScope, User } from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  isPlayerPhraseId,
  isSpectatorPhraseId,
  type ChatPhraseId,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { publishGameChanged } from "./events";

/**
 * Saying something in an online game.
 *
 * The whole feature is a catalog of canned phrases; see `social/chat.ts` in
 * @openchess/shared for why it is canned rather than free text. What is left
 * for this module is the small set of rules that make a fixed vocabulary
 * behave:
 *
 * - **Two conversations, and they never meet.** The players have one and the
 *   watchers have another. A player never sees a word the gallery says — a
 *   crowd commenting on a game you are still playing is a distraction at best
 *   and a coaching channel at worst — and a watcher never sees a word the
 *   players say, because the two of them did not sign up to be heard by an
 *   audience. Which channel a message is on is `GameMessage.scope`, and it is
 *   part of the query rather than a filter applied after one: a read that
 *   fetched both and threw half away would be one missing `where` clause from
 *   leaking each conversation into the other.
 * - **You are in exactly one of them.** A player writes to `PLAYERS` and may
 *   not write to `SPECTATORS`; anyone else signed in writes to `SPECTATORS`
 *   and may not write to `PLAYERS`. There is no seat that can speak in both.
 * - **Online games only.** The bot has nothing to say and no way to be told,
 *   and an AI game has no gallery — it is a private practice board.
 * - **A cap per sender per conversation per game.** A handful of canned
 *   phrases cannot be abusive one at a time; a hundred of them in a row can.
 *   The cap is what turns "the words are harmless" into "the feature is
 *   harmless".
 * - **Settled games still take messages.** "Good game" is said *after* the
 *   result. A rule that closed the channel the moment the game ended would shut
 *   it exactly when it is wanted, which is why both streams linger past the
 *   final position rather than hanging up on it.
 */

/**
 * How many messages one sender may put in one conversation in one game.
 *
 * Sized for the exchange the catalog actually supports — a greeting, a remark
 * or two, a good game — with enough slack that nobody hits it behaving
 * normally. Counted per sender rather than per game so one person cannot spend
 * everybody else's allowance, and per conversation so a watcher's twenty and a
 * player's twenty are not the same twenty.
 */
const MAX_MESSAGES_PER_SENDER = 20;

/**
 * How many messages a game view carries.
 *
 * The view is re-sent on every board change, so this rides along with each
 * move — a transcript that grew without bound would make a long game's stream
 * progressively more expensive to no purpose. The recent few are what a screen
 * can show anyway.
 */
const CHAT_WINDOW = 12;

export type ChatMessageView = {
  id: string;
  phrase: ChatPhraseId;
  /** True when the caller is the one who said it. */
  mine: boolean;
  username: string;
  createdAt: string;
};

const WITH_SENDER = {
  sender: { select: { id: true, username: true } },
} as const;

function view(
  row: {
    id: string;
    phrase: string;
    senderId: string;
    createdAt: Date;
    sender: { username: string };
  },
  userId: string,
): ChatMessageView {
  return {
    // Validated on the way in, so a stored phrase is a catalog key — but the
    // column is a plain string and a phrase retired since it was written would
    // otherwise widen this type to `string`. The cast is the narrow one, and
    // `chatPhraseText` is what copes with a key the catalog no longer has.
    id: row.id,
    phrase: row.phrase as ChatPhraseId,
    mine: row.senderId === userId,
    username: row.sender.username,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The recent messages in one of a game's conversations, oldest last. */
export async function listChat(
  gameId: string,
  userId: string,
  scope: ChatScope,
): Promise<ChatMessageView[]> {
  // Newest first is the indexed direction and the one that gives the *recent*
  // window; the reverse below is the order a transcript reads in.
  const rows = await db.gameMessage.findMany({
    where: { gameId, scope },
    orderBy: { createdAt: "desc" },
    take: CHAT_WINDOW,
    select: {
      id: true,
      phrase: true,
      senderId: true,
      createdAt: true,
      ...WITH_SENDER,
    },
  });

  return rows.reverse().map((row) => view(row, userId));
}

/**
 * Hang the players' transcript on a game view.
 *
 * A route-layer decoration, like `withGameLinks` beside it, rather than
 * something the game service assembles. The service builds a `GameView` inside
 * serializable transactions and from replayed positions; threading an extra
 * query through every one of those paths would buy nothing, since the messages
 * are not part of what any of them decide.
 *
 * An AI game skips the query outright — there is nobody on the other side of
 * it, so the answer is always empty.
 */
export async function attachChat<T extends { id: string; mode: "AI" | "PVP" }>(
  game: T,
  user: User,
): Promise<T & { chat: ChatMessageView[] }> {
  return {
    ...game,
    chat:
      game.mode === "PVP" ? await listChat(game.id, user.id, "PLAYERS") : [],
  };
}

/**
 * And the watchers' transcript on a spectator view.
 *
 * A separate function rather than a `scope` argument to the one above, because
 * the two are used at different doors and the argument would be the only thing
 * standing between a watcher and the players' conversation. Getting this wrong
 * has no compile error and no visible symptom on our side — it is simply a
 * private exchange rendered to strangers — so the two reads are kept as two
 * names that cannot be confused for each other.
 *
 * Every game reaching here is PvP: `watchGame` refuses anything else.
 */
export async function attachSpectatorChat<T extends { id: string }>(
  game: T,
  user: User,
): Promise<T & { chat: ChatMessageView[] }> {
  return { ...game, chat: await listChat(game.id, user.id, "SPECTATORS") };
}

/** Which seat `user` is in for this game, and so which channel they write to. */
function seatFor(
  game: { whitePlayerId: string | null; blackPlayerId: string | null },
  userId: string,
): ChatScope {
  return game.whitePlayerId === userId || game.blackPlayerId === userId
    ? "PLAYERS"
    : "SPECTATORS";
}

/** Say one of the catalog's phrases, in one of the game's two conversations. */
export async function sendChatMessage(input: {
  gameId: string;
  user: User;
  phrase: string;
  /** Which conversation the caller is asking to speak in. */
  scope: ChatScope;
}): Promise<ChatMessageView[]> {
  const game = await db.game.findUnique({
    where: { id: input.gameId },
    select: { id: true, mode: true, whitePlayerId: true, blackPlayerId: true },
  });

  if (!game) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  if (game.mode !== "PVP") {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      input.scope === "PLAYERS"
        ? "There is nobody to say that to — the bot does not read."
        : "An AI game has no gallery. It is a private board, and only the player at it can see it.",
    );
  }

  // The seat decides the channel, and the request only gets to agree with it.
  // Read off the game rather than taken from the caller, so "which
  // conversation am I in" is never something a client can answer for itself.
  const seat = seatFor(game, input.user.id);

  if (seat !== input.scope) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      seat === "PLAYERS"
        ? "You are playing this game — say it to your opponent, not to the gallery."
        : "You are not a player in this game. The watchers have their own channel.",
    );
  }

  // Belt to the route's braces: the schema enumerates the right catalog for the
  // route, and this is the check that holds if either is called from elsewhere.
  // Which catalog is the seat's, not the caller's — a player offering "what a
  // game" is narrating their own moves, and a watcher offering "sorry" is
  // apologising for somebody else's.
  const admits =
    input.scope === "PLAYERS" ? isPlayerPhraseId : isSpectatorPhraseId;

  if (!admits(input.phrase)) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `"${input.phrase}" is not something you can say here`,
    );
  }

  const sent = await db.gameMessage.count({
    where: { gameId: game.id, senderId: input.user.id, scope: input.scope },
  });

  if (sent >= MAX_MESSAGES_PER_SENDER) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have said your ${MAX_MESSAGES_PER_SENDER} for this game.`,
    );
  }

  await db.gameMessage.create({
    data: {
      gameId: game.id,
      senderId: input.user.id,
      scope: input.scope,
      phrase: input.phrase,
    },
  });

  // Everyone else in this conversation is on a stream; this is what wakes it.
  // Not awaited and never throwing, exactly as it is on the move path — a
  // notification that fails must not turn a message that was written into a
  // failed request, and the stream's own tick is the backstop.
  //
  // One counter for both channels, so a word in the gallery also wakes the
  // players' stream. It reloads, finds a signature that carries no spectator
  // message, and correctly says nothing — which is the cheap half of a trade
  // whose expensive half would be a second counter per game.
  publishGameChanged(game.id);

  return listChat(game.id, input.user.id, input.scope);
}
