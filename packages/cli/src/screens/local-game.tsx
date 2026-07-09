import { useCallback, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { Board } from "../components/board";
import { GameScreen } from "../components/game-screen";
import { useUITheme } from "../providers/theme";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../providers/keyboard-layer";
import {
  capturedPieces,
  createGame,
  fileOf,
  findKing,
  findLegalMove,
  isGameOver,
  isPiece,
  materialBalance,
  movePairs,
  movesFromSquare,
  needsPromotion,
  opposite,
  pieceAt,
  pieceColor,
  play,
  rankOf,
  squareAt,
  undo,
} from "../chess";
import type { Color, GameStatus, Piece, PromotionPiece } from "../chess";
import { renderPiece } from "../components/pieces";

const PROMOTION_CHOICES: Array<[PromotionPiece, string]> = [
  ["q", "Queen"],
  ["r", "Rook"],
  ["b", "Bishop"],
  ["n", "Knight"],
];

/** How many move pairs fit beside the board without stretching the frame. */
const VISIBLE_MOVE_PAIRS = 8;

function clamp(value: number): number {
  return Math.max(0, Math.min(7, value));
}

function colorName(color: Color): string {
  return color === "w" ? "White" : "Black";
}

function describeStatus(status: GameStatus, turn: Color): string {
  switch (status) {
    case "checkmate":
      return `${colorName(opposite(turn))} wins by checkmate`;
    case "stalemate":
      return "Draw by stalemate";
    case "draw-fifty-move":
      return "Draw by the fifty-move rule";
    case "draw-repetition":
      return "Draw by threefold repetition";
    case "draw-insufficient-material":
      return "Draw by insufficient material";
    case "check":
      return `${colorName(turn)} to move — check!`;
    case "playing":
      return `${colorName(turn)} to move`;
  }
}

/**
 * One side's haul: the label, the enemy pieces it has taken, and its material
 * lead in pawns — shown only on the side that is ahead.
 */
function CapturedRow({
  label,
  pieces,
  advantage,
  pieceFg,
}: {
  label: string;
  pieces: Piece[];
  advantage: number;
  pieceFg: string;
}) {
  const theme = useUITheme();

  return (
    <text>
      <span fg={theme.faint}>{label.padEnd(7)}</span>
      {pieces.length === 0 ? (
        <span fg={theme.faint}>—</span>
      ) : (
        <span fg={pieceFg}>{pieces.map(renderPiece).join(" ")}</span>
      )}
      {advantage > 0 ? <span fg={theme.gold}>{`  +${advantage}`}</span> : null}
    </text>
  );
}

export function LocalGame() {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();
  const [game, setGame] = useState(createGame);
  const [cursor, setCursor] = useState(() => squareAt(4, 1));
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<{ from: number; to: number } | null>(
    null,
  );
  const [flipped, setFlipped] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { position, status, history } = game;
  const over = isGameOver(status);
  const targets = selected === null ? [] : movesFromSquare(game, selected);
  const lastMove = history[history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  const reset = useCallback(() => {
    setGame(createGame());
    setCursor(squareAt(4, 1));
    setSelected(null);
    setPromotion(null);
    setMessage(null);
  }, []);

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

      if (pieceColor(piece) !== position.turn) {
        setMessage(`It's ${colorName(position.turn)}'s turn`);
        return;
      }

      if (movesFromSquare(game, square).length === 0) {
        setMessage("That piece has no legal moves");
        return;
      }

      setSelected(square);
      setMessage(null);
    },
    [game, position],
  );

  const confirm = useCallback(() => {
    if (over) {
      setMessage("The game is over — press r to play again");
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
  }, [commit, cursor, game, over, select, selected]);

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
        if (history.length > 0) {
          setGame(undo(game));
          setSelected(null);
          setMessage(null);
        }
        break;
      case "r":
        reset();
        break;
      case "f":
        setFlipped((value) => !value);
        break;
    }
  });

  const pairs = movePairs(game);
  const visible = pairs.slice(Math.max(0, pairs.length - VISIBLE_MOVE_PAIRS));
  const captures = capturedPieces(game);
  const balance = materialBalance(position);

  return (
    <GameScreen
      title="Local 1v1"
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
        <box flexDirection="column" width={16}>
          <text fg={theme.walnut}>Moves</text>
          {visible.length === 0 ? (
            <text fg={theme.faint}>—</text>
          ) : (
            visible.map((pair) => (
              <text key={pair.number}>
                <span fg={theme.faint}>{`${pair.number}.`.padEnd(4)}</span>
                <span fg={theme.cream}>{pair.white.padEnd(7)}</span>
                <span fg={theme.walnut}>{pair.black ?? ""}</span>
              </text>
            ))
          )}
        </box>
      </box>

      <box flexDirection="column" width="100%">
        <CapturedRow
          label="White"
          pieces={captures.byWhite}
          advantage={balance}
          pieceFg={theme.walnut}
        />
        <CapturedRow
          label="Black"
          pieces={captures.byBlack}
          advantage={-balance}
          pieceFg={theme.cream}
        />
      </box>

      {promotion ? (
        <text>
          <span fg={theme.gold}>Promote to: </span>
          {PROMOTION_CHOICES.map(([piece, label]) => (
            <span key={piece}>
              <span fg={theme.cream}>{piece.toUpperCase()}</span>
              <span fg={theme.faint}>{` ${label}  `}</span>
            </span>
          ))}
        </text>
      ) : (
        <text fg={over ? theme.gold : theme.dim}>
          {message ?? describeStatus(status, position.turn)}
        </text>
      )}
    </GameScreen>
  );
}
