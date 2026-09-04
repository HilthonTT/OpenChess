import { opposite } from "@openchess/shared";
import type { Color, GameStatus } from "@openchess/shared";
import { describeStatus } from "../../components/game-panels";
import type { ChatMessage } from "../../lib/games";

export const TITLE = "Online 1v1";

export const SUBTITLE = "Challenge a player over the network";

export const QUEUE_POLL_MS = 2_000;

export const CLAIM_AFTER_MS = 5 * 60_000;

export const CHAT_LAYER_ID = "online-chat";

export function lastMessageId(game: { chat: ChatMessage[] }): string {
  return game.chat.at(-1)?.id ?? "";
}

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
