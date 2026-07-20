import { findKing } from "@openchess/shared";
import type { Game, Move } from "@openchess/shared";
import { Board } from "./board";
import { CapturedSummary, MoveList, PromotionPrompt } from "./game-panels";
import { useUITheme } from "../providers/theme";

/**
 * The stack every game screen shares: board beside the move list, captures
 * underneath, and a status line that yields to the promotion picker.
 */
export function MatchView({
  game,
  cursor,
  selected,
  targets,
  flipped,
  promotion,
  over,
  statusText,
}: {
  game: Game;
  cursor: number;
  selected: number | null;
  targets: Move[];
  flipped: boolean;
  /** The promotion prompt replaces the status line while it is open. */
  promotion: boolean;
  over: boolean;
  statusText: string;
}) {
  const theme = useUITheme();
  const { position, status } = game;

  const lastMove = game.history[game.history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  return (
    <>
      <box flexDirection="row" gap={2}>
        <Board
          board={position.board}
          cursor={cursor}
          selected={selected}
          targets={targets}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
        />
        <MoveList game={game} />
      </box>

      <CapturedSummary game={game} />

      {promotion ? (
        <PromotionPrompt />
      ) : (
        <text fg={over ? theme.gold : theme.dim}>{statusText}</text>
      )}
    </>
  );
}
