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
import type { Color, PersonalityId, PromotionPiece } from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { MatchView } from "../../components/match-view";
import { useUITheme } from "../../providers/theme";
import { homeSquare, useBoardCursor } from "../../hooks/use-board-cursor";
import { useGameKeys } from "../../hooks/use-game-keys";
import { useMoveSelection } from "../../hooks/use-move-selection";
import { useKeymap, type Keymap } from "../../providers/keymap";
import { BOARD_ESCAPE, BOARD_KEYS, COPY_KEYS } from "../../lib/keymaps";
import { Setup, describeAiStatus, type Variant } from "./setup";

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
  startFen: string | null;
};

export function LocalAIGame({ subtitle }: { subtitle?: string }) {
  const [started, setStarted] = useState<Started | null>(null);

  if (started === null) {
    return (
      <Setup
        onStart={(choice) => {
          setStarted({
            personality: choice.personality,
            human: choice.color,
            variant: choice.variant,
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

  useEffect(() => {
    if (!aiTurn) {
      return;
    }

    const timer = setTimeout(() => {
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
