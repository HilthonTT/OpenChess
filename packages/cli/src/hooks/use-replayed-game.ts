import { useMemo } from "react";
import { createGame, playSan } from "@openchess/shared";
import type { Game } from "@openchess/shared";

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

export function useReplayedGame(
  history: string[],
  startFen: string | null = null,
): Game {
  return useMemo(() => replayHistory(history, startFen), [history, startFen]);
}
