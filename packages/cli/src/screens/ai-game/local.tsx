import { useCallback, useEffect, useState } from "react";
import {
  createGame,
  findBestMove,
  isGameOver,
  PERSONALITIES,
  play,
  randomChess960Fen,
  undo,
} from "@openchess/shared";
import type {
  Color,
  PersonalityId,
  PromotionPiece,
} from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { MatchView } from "../../components/match-view";
import { useUITheme } from "../../providers/theme";
import { homeSquare, useBoardCursor } from "../../hooks/use-board-cursor";
import { useGameKeys } from "../../hooks/use-game-keys";
import { useMoveSelection } from "../../hooks/use-move-selection";
import { useKeymap, type Keymap } from "../../providers/keymap";
import { BOARD_ESCAPE, BOARD_KEYS, COPY_KEYS } from "../../lib/keymaps";
import { Setup, describeAiStatus, type Variant } from "./setup";

/** A short pause before the engine replies, so its moves are easy to follow. */
const AI_MOVE_DELAY_MS = 400;

const KEYMAP: Keymap = {
  title: "Play vs AI — offline",
  escape: BOARD_ESCAPE,
  sections: [
    { title: "At the board", keys: BOARD_KEYS },
    {
      title: "The game",
      keys: [
        { keys: "u", label: "take your move and the engine's reply back" },
        { keys: "r", label: "start a new game against the same opponent" },
      ],
    },
    { title: "Copy out", keys: COPY_KEYS },
  ],
};

type Started = {
  personality: PersonalityId;
  human: Color;
  variant: Variant;
  /** The array dealt for a shuffled game, or null for the ordinary one. */
  startFen: string | null;
};

/** The engine runs in-process: nothing is saved and nothing is earned. */
export function LocalAIGame({ subtitle }: { subtitle?: string }) {
  const [started, setStarted] = useState<Started | null>(null);

  if (started === null) {
    // No clock offline: it would need in-process timing with nothing to enforce
    // it against, so the engine game stays untimed.
    return (
      <Setup
        onStart={(choice) => {
          setStarted({
            personality: choice.personality,
            human: choice.color,
            variant: choice.variant,
            // Dealt once, here, so that "new game" below can redeal it while
            // the board itself stays a pure function of what it was given.
            startFen:
              choice.variant === "CHESS960" ? randomChess960Fen() : null,
          });
        }}
        subtitle={subtitle}
      />
    );
  }

  return (
    <Match
      key={started.startFen ?? "standard"}
      personality={started.personality}
      human={started.human}
      variant={started.variant}
      startFen={started.startFen}
      onRedeal={() =>
        setStarted((current) =>
          current === null || current.variant !== "CHESS960"
            ? current
            : { ...current, startFen: randomChess960Fen() },
        )
      }
    />
  );
}

function Match({
  personality,
  human,
  variant,
  startFen,
  onRedeal,
}: {
  personality: PersonalityId;
  human: Color;
  variant: Variant;
  startFen: string | null;
  onRedeal: () => void;
}) {
  const theme = useUITheme();
  useKeymap(KEYMAP);
  const [game, setGame] = useState(() => createGame(startFen ?? undefined));

  /** What the bot is called in an exported header, as the server names it too. */
  const botName = `OpenChess ${PERSONALITIES[personality].name}`;

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
      // The positions already played, so the engine can tell a repetition from a
      // fresh position rather than shuffling a won game into a draw.
      const move = findBestMove(
        game.position,
        personality,
        game.history.map((entry) => entry.before),
      );
      if (move) {
        setGame((current) => (current === game ? play(game, move) : current));
        clearSelection();
        setMessage(null);
      }
    }, AI_MOVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [aiTurn, clearSelection, game, personality, setMessage]);

  const reset = useCallback(() => {
    // A new shuffled game deals a new array — replaying the same one would make
    // "new game" mean "same position again", which is the opposite of the point.
    onRedeal();
    setGame(createGame(startFen ?? undefined));
    cursor.resetCursor();
    clearSelection();
    setMessage(null);
  }, [clearSelection, cursor.resetCursor, onRedeal, setMessage, startFen]);

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
    // Nothing is at stake in an offline game, so the position is the player's
    // to take wherever they like — including to a stronger engine than this one.
    copy: {
      game,
      pgn: {
        tags: {
          event: "OpenChess AI game",
          white: human === "w" ? "You" : botName,
          black: human === "b" ? "You" : botName,
        },
      },
      onNote: setMessage,
    },
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
      title={`Play vs AI · ${PERSONALITIES[personality].name}${
        variant === "CHESS960" ? " · Chess960" : ""
      }`}
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
