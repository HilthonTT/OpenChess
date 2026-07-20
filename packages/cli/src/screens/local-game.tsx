import { useCallback, useState } from "react";
import { GameScreen } from "../components/game-screen";
import { MatchView } from "../components/match-view";
import { useUITheme } from "../providers/theme";
import { createGame, isGameOver, play, squareAt, undo } from "@openchess/shared";
import type { PromotionPiece } from "@openchess/shared";
import { describeStatus } from "../components/game-panels";
import { useBoardCursor } from "../hooks/use-board-cursor";
import { useGameKeys } from "../hooks/use-game-keys";
import { useMoveSelection } from "../hooks/use-move-selection";

export function LocalGame() {
  const theme = useUITheme();
  const [game, setGame] = useState(createGame);

  const cursor = useBoardCursor({ initialSquare: squareAt(4, 1) });

  const { position, status, history } = game;
  const over = isGameOver(status);

  // No `you` side: whoever's turn it is holds the keyboard.
  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The game is over — press r to play again",
  });
  const { beginCommit, clearSelection, setMessage } = selection;

  const reset = useCallback(() => {
    setGame(createGame());
    cursor.resetCursor();
    clearSelection();
    setMessage(null);
  }, [clearSelection, cursor.resetCursor, setMessage]);

  const commit = useCallback(
    (from: number, to: number, choice?: PromotionPiece) => {
      const move = beginCommit(from, to, choice);
      if (move) {
        setGame(play(game, move));
      }
    },
    [beginCommit, game],
  );

  useGameKeys({
    selection,
    cursor,
    commit,
    onKey: (name) => {
      switch (name) {
        case "u":
          if (history.length > 0) {
            setGame(undo(game));
            clearSelection();
            setMessage(null);
          }
          break;
        case "r":
          reset();
          break;
      }
    },
  });

  return (
    <GameScreen
      title="Local 1v1"
      width={58}
      onEscape={selection.handleEscape}
      footer={
        <>
          <span fg={theme.cream}>↑↓←→</span>
          <span fg={theme.faint}> move </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> select </span>
          <span fg={theme.cream}>u</span>
          <span fg={theme.faint}> undo </span>
          <span fg={theme.cream}>r</span>
          <span fg={theme.faint}> new </span>
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
        </>
      }
    >
      <MatchView
        game={game}
        cursor={cursor.cursor}
        selected={selection.selected}
        targets={selection.targets}
        flipped={cursor.flipped}
        promotion={selection.promotion !== null}
        over={over}
        statusText={selection.message ?? describeStatus(status, position.turn)}
      />
    </GameScreen>
  );
}
