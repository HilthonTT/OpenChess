import { useMemo } from "react";
import { createGame, playSan } from "@openchess/shared";
import type { Game } from "@openchess/shared";

/**
 * The board as the server tells it, rebuilt move by move from its SAN history.
 *
 * `startFen` is the array the game began from — null for an ordinary game, and
 * the dealt position for a shuffled one. Replaying a Chess960 game's moves onto
 * the standard array does not merely mislabel it: the same SAN names different
 * pieces, so the first move either lands somewhere else or fails outright.
 *
 * That SAN works across both variants at all is the reason this stays one
 * function. Castling reads as `O-O` whatever files the king and rook began on,
 * so the history is identical; it is only the position underneath that differs.
 */
export function replayHistory(
  history: string[],
  startFen: string | null = null,
): Game {
  let game = createGame(startFen ?? undefined);
  for (const san of history) {
    game = playSan(game, san);
  }
  return game;
}

/**
 * The server's history is the game. Replaying it through the same rules code
 * the server runs gives every panel a full local Game to render from.
 */
export function useReplayedGame(
  history: string[],
  startFen: string | null = null,
): Game {
  return useMemo(() => replayHistory(history, startFen), [history, startFen]);
}
