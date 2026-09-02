import { opposite } from "@openchess/shared";
import type { Color, GameStatus } from "@openchess/shared";
import { describeStatus } from "../../components/game-panels";
import type { ChatMessage } from "../../lib/games";

export const TITLE = "Online 1v1";

export const SUBTITLE = "Challenge a player over the network";

/**
 * How often a searching player pokes the queue — also its heartbeat.
 *
 * The queue is still polled, unlike a live game: a poll *is* the "I am still
 * here" signal the server pairs on, so there is nothing to push until there is
 * something to say, and by then the poll has already asked.
 */
export const QUEUE_POLL_MS = 2_000;

/**
 * How long the opponent must sit on their turn before we offer the claim key.
 * Matches the server's own window; ours starts later (when this client saw the
 * position), so by the time the offer shows, the server already agrees.
 */
export const CLAIM_AFTER_MS = 5 * 60_000;

/**
 * The layer the phrase picker takes while it is open, so the board's own keys
 * go quiet underneath it — `1` has to mean "say hello" and not fall through to
 * anything the board might one day bind it to.
 */
export const CHAT_LAYER_ID = "online-chat";

/** The newest message's id, or "" — how a client tells one transcript from another. */
export function lastMessageId(game: { chat: ChatMessage[] }): string {
  return game.chat.at(-1)?.id ?? "";
}

/** The status line reworded for a game against a named human. */
export function describeOnlineStatus(
  status: GameStatus,
  turn: Color,
  you: Color,
  opponent: string,
): string {
  switch (status) {
    case "checkmate":
      return opposite(turn) === you
        ? "Checkmate — you win!"
        : `Checkmate — ${opponent} wins`;
    case "check":
      return turn === you
        ? "Your move — check!"
        : `${opponent} to move — check!`;
    case "playing":
      return turn === you ? "Your move" : `Waiting for ${opponent}…`;
    default:
      return describeStatus(status, turn);
  }
}
