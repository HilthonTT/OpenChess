import type { User } from "@openchess/database";
import { db } from "@openchess/database/client";
import { isChatPhraseId, type ChatPhraseId } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { publishGameChanged } from "./events";

/**
 * Saying something in an online game.
 *
 * The whole feature is a catalog of nine phrases; see `social/chat.ts` in
 * @openchess/shared for why it is canned rather than free text. What is left
 * for this module is the small set of rules that make a fixed vocabulary
 * behave:
 *
 * - **Players only.** A spectator can watch a game but cannot talk in it, and
 *   the spectator view carries no chat at all — the two people playing did not
 *   sign up to be heard by an audience.
 * - **Online games only.** The bot has nothing to say and no way to be told.
 * - **A cap per player per game.** Nine phrases cannot be abusive one at a
 *   time; a hundred of them in a row can. The cap is what turns "the words are
 *   harmless" into "the feature is harmless".
 * - **Settled games still take messages.** "Good game" is said *after* the
 *   result. A rule that closed the channel the moment the game ended would shut
 *   it exactly when it is wanted, which is why the players' stream lingers past
 *   the final position rather than hanging up on it.
 */

/**
 * How many messages one player may send in one game.
 *
 * Sized for the conversation the catalog actually supports — a greeting, a
 * remark or two, a good game — with enough slack that nobody hits it playing
 * normally. Counted per player rather than per game so one side cannot spend
 * the other's allowance.
 */
const MAX_MESSAGES_PER_PLAYER = 20;

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

/** The recent messages in a game, oldest last. */
export async function listChat(
  gameId: string,
  userId: string,
): Promise<ChatMessageView[]> {
  // Newest first is the indexed direction and the one that gives the *recent*
  // window; the reverse below is the order a transcript reads in.
  const rows = await db.gameMessage.findMany({
    where: { gameId },
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
 * Hang the transcript on a game view.
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
    chat: game.mode === "PVP" ? await listChat(game.id, user.id) : [],
  };
}

/** Say one of the nine things. Returns the transcript with it on the end. */
export async function sendChatMessage(input: {
  gameId: string;
  user: User;
  phrase: string;
}): Promise<ChatMessageView[]> {
  // Belt to the route's braces: the schema enumerates the catalog, and this is
  // the check that holds if this is ever called from anywhere else.
  if (!isChatPhraseId(input.phrase)) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `"${input.phrase}" is not something you can say`,
    );
  }

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
      "There is nobody to say that to — the bot does not read.",
    );
  }

  if (
    game.whitePlayerId !== input.user.id &&
    game.blackPlayerId !== input.user.id
  ) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      "You are not a player in this game",
    );
  }

  const sent = await db.gameMessage.count({
    where: { gameId: game.id, senderId: input.user.id },
  });

  if (sent >= MAX_MESSAGES_PER_PLAYER) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have said your ${MAX_MESSAGES_PER_PLAYER} for this game.`,
    );
  }

  await db.gameMessage.create({
    data: {
      gameId: game.id,
      senderId: input.user.id,
      phrase: input.phrase,
    },
  });

  // The opponent is on the game's stream; this is what wakes it. Not awaited
  // and never throwing, exactly as it is on the move path — a notification that
  // fails must not turn a message that was written into a failed request, and
  // the stream's own tick is the backstop.
  publishGameChanged(game.id);

  return listChat(game.id, input.user.id);
}
