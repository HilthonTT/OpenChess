import { useCallback, useEffect, useState } from "react";
import {
  createGame,
  findBestMove,
  isGameOver,
  play,
  undo,
} from "@openchess/shared";
import type { Color, Difficulty, PromotionPiece } from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { MatchView } from "../../components/match-view";
import { useUITheme } from "../../providers/theme";
import { homeSquare, useBoardCursor } from "../../hooks/use-board-cursor";
import { useGameKeys } from "../../hooks/use-game-keys";
import { useMoveSelection } from "../../hooks/use-move-selection";
import { DIFFICULTY_LABELS, Setup, describeAiStatus } from "./setup";

/** A short pause before the engine replies, so its moves are easy to follow. */
const AI_MOVE_DELAY_MS = 400;

/** The engine runs in-process: nothing is saved and nothing is earned. */
export function LocalAIGame({ subtitle }: { subtitle?: string }) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [human, setHuman] = useState<Color | null>(null);

  if (difficulty === null || human === null) {
    // No clock offline: it would need in-process timing with nothing to enforce
    // it against, so the engine game stays untimed.
    return (
      <Setup
        onStart={(choice) => {
          setDifficulty(choice.difficulty);
          setHuman(choice.color);
        }}
        subtitle={subtitle}
      />
    );
  }

  return <Match difficulty={difficulty} human={human} />;
}

function Match({
  difficulty,
  human,
}: {
  difficulty: Difficulty;
  human: Color;
}) {
  const theme = useUITheme();
  const [game, setGame] = useState(createGame);

  const cursor = useBoardCursor({
    initialSquare: homeSquare(human),
    initiallyFlipped: human === "b",
  });

  const { position, status } = game;
  const over = isGameOver(status);
  const aiTurn = position.turn !== human && !over;

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The game is over — press r to play again",
    you: { color: human, waitMessage: "The engine is thinking…" },
  });
  const { beginCommit, clearSelection, setMessage } = selection;

  // The engine replies whenever the position is its to move. Depending on
  // `game` means any human action (move, undo, reset) cancels a pending reply
  // and re-evaluates against the fresh position.
  useEffect(() => {
    if (!aiTurn) {
      return;
    }

    const timer = setTimeout(() => {
      const move = findBestMove(game.position, difficulty);
      if (move) {
        setGame((current) => (current === game ? play(game, move) : current));
        clearSelection();
        setMessage(null);
      }
    }, AI_MOVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [aiTurn, clearSelection, difficulty, game, setMessage]);

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

  /** Take back moves until it is the player's turn again. */
  const undoTurn = useCallback(() => {
    let next = game;
    if (next.history.length > 0) {
      next = undo(next);
    }
    if (next.position.turn !== human && next.history.length > 0) {
      next = undo(next);
    }

    if (next !== game) {
      setGame(next);
      clearSelection();
      setMessage(null);
    }
  }, [clearSelection, game, human, setMessage]);

  useGameKeys({
    selection,
    cursor,
    commit,
    onKey: (name) => {
      switch (name) {
        case "u":
          undoTurn();
          break;
        case "r":
          reset();
          break;
      }
    },
  });

  return (
    <GameScreen
      title={`Play vs AI · ${DIFFICULTY_LABELS[difficulty]}`}
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
        statusText={
          selection.message ??
          (aiTurn
            ? "The engine is thinking…"
            : describeAiStatus(status, position.turn, human))
        }
      />
    </GameScreen>
  );
}
