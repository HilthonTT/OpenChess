import { useCallback, useState } from "react";
import { GameScreen } from "../components/game-screen";
import { MatchView } from "../components/match-view";
import { useUITheme } from "../providers/theme";
import {
  createGame,
  isGameOver,
  play,
  randomChess960Fen,
  squareAt,
  undo,
} from "@openchess/shared";
import type { PromotionPiece } from "@openchess/shared";
import { describeStatus } from "../components/game-panels";
import { useBoardCursor } from "../hooks/use-board-cursor";
import { useGameKeys } from "../hooks/use-game-keys";
import { useMoveSelection } from "../hooks/use-move-selection";
import { useKeymap, type Keymap } from "../providers/keymap";
import { BOARD_ESCAPE, BOARD_KEYS, COPY_KEYS } from "../lib/keymaps";

const KEYMAP: Keymap = {
  title: "Local 1v1",
  escape: BOARD_ESCAPE,
  sections: [
    { title: "At the board", keys: BOARD_KEYS },
    {
      title: "The game",
      keys: [
        { keys: "u", label: "take the last move back" },
        { keys: "r", label: "start a new game in the same array" },
        { keys: "9", label: "switch between the ordinary array and Chess960" },
      ],
    },
    { title: "Copy out", keys: COPY_KEYS },
  ],
};

export function LocalGame() {
  const theme = useUITheme();
  /**
   * The array in play, or null for the ordinary one. Held apart from the game
   * so that `r` restarts the same *variant* rather than the same position: a
   * shuffled game that replayed its own array on every reset would only ever
   * be one shuffled game.
   */
  const [startFen, setStartFen] = useState<string | null>(null);
  const [game, setGame] = useState(createGame);

  const cursor = useBoardCursor({ initialSquare: squareAt(4, 1) });

  useKeymap(KEYMAP);

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

  /** Start again — a fresh array when the game in play is a shuffled one. */
  const reset = useCallback(() => {
    const fen = startFen === null ? null : randomChess960Fen();
    setStartFen(fen);
    setGame(createGame(fen ?? undefined));
    cursor.resetCursor();
    clearSelection();
    setMessage(null);
  }, [clearSelection, cursor.resetCursor, setMessage, startFen]);

  /** Switch between the ordinary array and a shuffled one, dealing as it goes. */
  const toggleVariant = useCallback(() => {
    const fen = startFen === null ? randomChess960Fen() : null;
    setStartFen(fen);
    setGame(createGame(fen ?? undefined));
    cursor.resetCursor();
    clearSelection();
    setMessage(null);
  }, [clearSelection, cursor.resetCursor, setMessage, startFen]);

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
    copy: {
      game,
      pgn: { tags: { event: "OpenChess local game" } },
      onNote: setMessage,
    },
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
        case "9":
          toggleVariant();
          break;
      }
    },
  });

  return (
    <GameScreen
      title={`Local 1v1${startFen === null ? "" : " · Chess960"}`}
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
          <span fg={theme.cream}>y</span>
          <span fg={theme.faint}> copy </span>
          <span fg={theme.cream}>9</span>
          <span fg={theme.faint}>
            {startFen === null ? " chess960 " : " standard "}
          </span>
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
