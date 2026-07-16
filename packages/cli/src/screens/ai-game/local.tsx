import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  createGame,
  fileOf,
  findBestMove,
  findKing,
  findLegalMove,
  isGameOver,
  isPiece,
  movesFromSquare,
  needsPromotion,
  pieceAt,
  pieceColor,
  play,
  rankOf,
  squareAt,
  undo,
} from "@openchess/shared";
import type { Color, Difficulty, PromotionPiece } from "@openchess/shared";
import { Board } from "../../components/board";
import { GameScreen } from "../../components/game-screen";
import {
  CapturedSummary,
  MoveList,
  PROMOTION_CHOICES,
  PromotionPrompt,
  colorName,
} from "../../components/game-panels";
import { useUITheme } from "../../providers/theme";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { DIFFICULTY_LABELS, Setup, clamp, describeAiStatus } from "./setup";

/** A short pause before the engine replies, so its moves are easy to follow. */
const AI_MOVE_DELAY_MS = 400;

/** The engine runs in-process: nothing is saved and nothing is earned. */
export function LocalAIGame({ subtitle }: { subtitle?: string }) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [human, setHuman] = useState<Color | null>(null);

  if (difficulty === null || human === null) {
    return (
      <Setup
        difficulty={difficulty}
        onDifficulty={setDifficulty}
        onColor={setHuman}
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
  const { isTopLayer } = useKeyboardLayer();
  const [game, setGame] = useState(createGame);
  const [cursor, setCursor] = useState(() =>
    squareAt(4, human === "w" ? 1 : 6),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [flipped, setFlipped] = useState(human === "b");
  const [message, setMessage] = useState<string | null>(null);

  const { position, status, history } = game;
  const over = isGameOver(status);
  const aiTurn = position.turn !== human && !over;
  const targets = selected === null ? [] : movesFromSquare(game, selected);
  const lastMove = history[history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

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
        setSelected(null);
        setMessage(null);
      }
    }, AI_MOVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [aiTurn, game, difficulty]);

  const reset = useCallback(() => {
    setGame(createGame());
    setCursor(squareAt(4, human === "w" ? 1 : 6));
    setSelected(null);
    setPromotion(null);
    setMessage(null);
  }, [human]);

  /** Escape unwinds one step at a time before it gives up the screen. */
  const handleEscape = useCallback(() => {
    if (promotion) {
      setPromotion(null);
      return true;
    }

    if (selected !== null) {
      setSelected(null);
      return true;
    }

    return false;
  }, [promotion, selected]);

  const commit = useCallback(
    (from: number, to: number, choice?: PromotionPiece) => {
      const move = findLegalMove(game, from, to, choice);
      if (!move) {
        setMessage("That isn't a legal move");
        return;
      }

      setGame(play(game, move));
      setSelected(null);
      setPromotion(null);
      setMessage(null);
    },
    [game],
  );

  /** Pick up the piece under the cursor, explaining why when we can't. */
  const select = useCallback(
    (square: number) => {
      const piece = pieceAt(position.board, square);

      if (!isPiece(piece)) {
        setMessage("That square is empty");
        return;
      }

      if (pieceColor(piece) !== human) {
        setMessage(`You play the ${colorName(human)} pieces`);
        return;
      }

      if (movesFromSquare(game, square).length === 0) {
        setMessage("That piece has no legal moves");
        return;
      }

      setSelected(square);
      setMessage(null);
    },
    [game, human, position],
  );

  const confirm = useCallback(() => {
    if (over) {
      setMessage("The game is over — press r to play again");
      return;
    }

    if (aiTurn) {
      setMessage("The engine is thinking…");
      return;
    }

    if (selected === null) {
      select(cursor);
      return;
    }

    if (cursor === selected) {
      setSelected(null);
      return;
    }

    if (needsPromotion(game, selected, cursor)) {
      setPromotion({ from: selected, to: cursor });
      return;
    }

    if (findLegalMove(game, selected, cursor)) {
      commit(selected, cursor);
      return;
    }

    // Not a legal destination: treat it as picking a different piece instead.
    select(cursor);
  }, [aiTurn, commit, cursor, game, over, select, selected]);

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      // Flipping the board flips which way "up" moves the cursor, so the arrow
      // keys always agree with what the player sees.
      const sign = flipped ? -1 : 1;
      const x = clamp(fileOf(cursor) + dx * sign);
      const y = clamp(rankOf(cursor) + dy * sign);
      setCursor(squareAt(x, y));
    },
    [cursor, flipped],
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
      setSelected(null);
      setPromotion(null);
      setMessage(null);
    }
  }, [game, human]);

  useKeyboard((key) => {
    // Game keys belong to the screen itself; stay quiet under any open dialog.
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (promotion) {
      const choice = PROMOTION_CHOICES.find(([piece]) => piece === key.name);
      if (choice) {
        commit(promotion.from, promotion.to, choice[0]);
      }
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        moveCursor(0, 1);
        break;
      case "down":
      case "j":
        moveCursor(0, -1);
        break;
      case "left":
      case "h":
        moveCursor(-1, 0);
        break;
      case "right":
      case "l":
        moveCursor(1, 0);
        break;
      case "return":
      case "space":
        confirm();
        break;
      case "u":
        undoTurn();
        break;
      case "r":
        reset();
        break;
      case "f":
        setFlipped((value) => !value);
        break;
    }
  });

  return (
    <GameScreen
      title={`Play vs AI · ${DIFFICULTY_LABELS[difficulty]}`}
      width={58}
      onEscape={handleEscape}
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
        <text fg={over ? theme.gold : theme.dim}>
          {message ??
            (aiTurn
              ? "The engine is thinking…"
              : describeAiStatus(status, position.turn, human))}
        </text>
      )}
    </GameScreen>
  );
}
