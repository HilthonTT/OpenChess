import { useUITheme } from "../providers/theme";
import {
  capturedPieces,
  materialBalance,
  movePairs,
  opposite,
} from "@openchess/shared";
import type {
  Color,
  Game,
  GameStatus,
  Piece,
  PromotionPiece,
} from "@openchess/shared";
import { usePieceSet } from "../providers/pieces";
import { renderPiece } from "./pieces";

export const PROMOTION_CHOICES: Array<[PromotionPiece, string]> = [
  ["q", "Queen"],
  ["r", "Rook"],
  ["b", "Bishop"],
  ["n", "Knight"],
];

const VISIBLE_MOVE_PAIRS = 8;

export function colorName(color: Color): string {
  return color === "w" ? "White" : "Black";
}

export function describeStatus(status: GameStatus, turn: Color): string {
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

export function MoveList({ game }: { game: Game }) {
  const theme = useUITheme();
  const pairs = movePairs(game);
  const visible = pairs.slice(Math.max(0, pairs.length - VISIBLE_MOVE_PAIRS));

  return (
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
  );
}

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
  const pieceSet = usePieceSet();

  return (
    <text>
      <span fg={theme.faint}>{label.padEnd(7)}</span>
      {pieces.length === 0 ? (
        <span fg={theme.faint}>—</span>
      ) : (
        <span fg={pieceFg}>
          {pieces.map((piece) => renderPiece(piece, pieceSet)).join(" ")}
        </span>
      )}
      {advantage > 0 ? <span fg={theme.gold}>{`  +${advantage}`}</span> : null}
    </text>
  );
}

export function CapturedSummary({ game }: { game: Game }) {
  const theme = useUITheme();
  const captures = capturedPieces(game);
  const balance = materialBalance(game.position);

  return (
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
  );
}

export function PromotionPrompt() {
  const theme = useUITheme();

  return (
    <text>
      <span fg={theme.gold}>Promote to: </span>
      {PROMOTION_CHOICES.map(([piece, label]) => (
        <span key={piece}>
          <span fg={theme.cream}>{piece.toUpperCase()}</span>
          <span fg={theme.faint}>{` ${label}  `}</span>
        </span>
      ))}
    </text>
  );
}
