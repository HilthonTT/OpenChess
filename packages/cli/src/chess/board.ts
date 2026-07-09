import type {
  Board,
  CastlingRights,
  Color,
  Piece,
  Position,
  SquareContent,
} from "./types";
import { EMPTY } from "./types";

export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const FILES = "abcdefgh";

/**
 * Squares are stored in FEN order (index 0 = a8, index 63 = h1) but reasoned
 * about in board coordinates: `x` counts files left to right (0 = a) and `y`
 * counts ranks bottom to top (0 = rank 1). White therefore advances as `y`
 * grows, which keeps the pawn and castling code readable.
 */
export function squareAt(x: number, y: number): number {
  return (7 - y) * 8 + x;
}

export function fileOf(square: number): number {
  return square % 8;
}

export function rankOf(square: number): number {
  return 7 - Math.floor(square / 8);
}

export function isOnBoard(x: number, y: number): boolean {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

/** "e4" -> square index. Returns null for anything that isn't a square name. */
export function fromAlgebraic(name: string): number | null {
  if (name.length !== 2) {
    return null;
  }

  const x = FILES.indexOf(name[0] as string);
  const y = Number(name[1]) - 1;
  if (x < 0 || !isOnBoard(x, y)) {
    return null;
  }

  return squareAt(x, y);
}

/** Square index -> "e4". */
export function toAlgebraic(square: number): string {
  return `${FILES[fileOf(square)]}${rankOf(square) + 1}`;
}

export function pieceColor(piece: Piece): Color {
  return piece === piece.toUpperCase() ? "w" : "b";
}

export function isPiece(square: SquareContent): square is Piece {
  return square !== EMPTY;
}

/** True when `square` holds a piece belonging to `color`. */
export function isColor(square: SquareContent, color: Color): boolean {
  return isPiece(square) && pieceColor(square) === color;
}

export function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

/** Cast a piece kind to the FEN letter for `color`. */
export function toPiece(type: string, color: Color): Piece {
  return (color === "w" ? type.toUpperCase() : type.toLowerCase()) as Piece;
}

export function emptyBoard(): Board {
  return Array<SquareContent>(64).fill(EMPTY);
}

export function pieceAt(board: Board, square: number): SquareContent {
  return board[square] ?? EMPTY;
}

/** Locate `color`'s king, or null if it has none (only reachable in test positions). */
export function findKing(board: Board, color: Color): number | null {
  const king: Piece = color === "w" ? "K" : "k";
  const square = board.indexOf(king);
  return square === -1 ? null : square;
}

const CASTLING_ORDER: Array<[keyof CastlingRights, string]> = [
  ["whiteKingSide", "K"],
  ["whiteQueenSide", "Q"],
  ["blackKingSide", "k"],
  ["blackQueenSide", "q"],
];

export function noCastlingRights(): CastlingRights {
  return {
    whiteKingSide: false,
    whiteQueenSide: false,
    blackKingSide: false,
    blackQueenSide: false,
  };
}

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const [placement, turn, castling, enPassant, halfmove, fullmove] = parts;

  if (!placement || !turn || !castling || !enPassant) {
    throw new Error(`Invalid FEN: "${fen}"`);
  }

  const board = emptyBoard();
  const ranks = placement.split("/");
  if (ranks.length !== 8) {
    throw new Error(`Invalid FEN: expected 8 ranks, got ${ranks.length}`);
  }

  ranks.forEach((rank, rankIndex) => {
    let x = 0;
    for (const char of rank) {
      if (/[1-8]/.test(char)) {
        x += Number(char);
        continue;
      }

      if (!/[pnbrqkPNBRQK]/.test(char)) {
        throw new Error(`Invalid FEN: unexpected piece "${char}"`);
      }

      if (x > 7) {
        throw new Error(`Invalid FEN: rank "${rank}" overflows`);
      }

      board[rankIndex * 8 + x] = char as Piece;
      x += 1;
    }

    if (x !== 8) {
      throw new Error(`Invalid FEN: rank "${rank}" has ${x} squares`);
    }
  });

  if (turn !== "w" && turn !== "b") {
    throw new Error(`Invalid FEN: bad side to move "${turn}"`);
  }

  const rights = noCastlingRights();
  for (const [key, flag] of CASTLING_ORDER) {
    if (castling.includes(flag)) {
      rights[key] = true;
    }
  }

  return {
    board,
    turn,
    castling: rights,
    enPassant: enPassant === "-" ? null : fromAlgebraic(enPassant),
    halfmoveClock: halfmove ? Number(halfmove) : 0,
    fullmoveNumber: fullmove ? Number(fullmove) : 1,
  };
}

export function toFen(position: Position): string {
  const rows: string[] = [];
  for (let rank = 0; rank < 8; rank++) {
    let row = "";
    let gap = 0;

    for (let x = 0; x < 8; x++) {
      const piece = pieceAt(position.board, rank * 8 + x);
      if (piece === EMPTY) {
        gap += 1;
        continue;
      }

      if (gap > 0) {
        row += String(gap);
        gap = 0;
      }
      row += piece;
    }

    if (gap > 0) {
      row += String(gap);
    }
    rows.push(row);
  }

  const castling =
    CASTLING_ORDER.filter(([key]) => position.castling[key])
      .map(([, flag]) => flag)
      .join("") || "-";

  const enPassant =
    position.enPassant === null ? "-" : toAlgebraic(position.enPassant);

  return [
    rows.join("/"),
    position.turn,
    castling,
    enPassant,
    position.halfmoveClock,
    position.fullmoveNumber,
  ].join(" ");
}

/**
 * Identifies a position for threefold-repetition purposes: the pieces, the side
 * to move, castling rights, and the en passant square — but not the clocks.
 */
export function repetitionKey(position: Position): string {
  const fen = toFen(position);
  return fen.split(" ").slice(0, 4).join(" ");
}
