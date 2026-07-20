import { useMemo } from "react";
import { createGame, playSan } from "@openchess/shared";
import type { Game } from "@openchess/shared";

/** The board as the server tells it, rebuilt move by move from its SAN history. */
export function replayHistory(history: string[]): Game {
  let game = createGame();
  for (const san of history) {
    game = playSan(game, san);
  }
  return game;
}

/**
 * The server's history is the game. Replaying it through the same rules code
 * the server runs gives every panel a full local Game to render from.
 */
export function useReplayedGame(history: string[]): Game {
  return useMemo(() => replayHistory(history), [history]);
}
