import type { Piece, SquareContent } from "@openchess/shared";
import { EMPTY } from "@openchess/shared";

/**
 * Variation selector (U+FE0E) appended to a chess glyph to force text (not
 * emoji) presentation, so the terminal honors our `fg` color instead of
 * drawing the piece as a fixed-color emoji.
 */
export const TEXT_PRESENTATION = String.fromCharCode(0xfe0e);

/**
 * Glyphs are chosen for contrast, not for the color they are named after: the
 * solid (nominally black) glyphs read as white pieces on a dark terminal, and
 * the hollow ones read as black. Both are painted with an explicit `fg`.
 */
const DISPLAY: Record<SquareContent, string> = {
  [EMPTY]: " ",
  B: "♝",
  K: "♚",
  N: "♞",
  P: "♟",
  Q: "♛",
  R: "♜",
  b: "♗",
  k: "♔",
  n: "♘",
  p: "♙",
  q: "♕",
  r: "♖",
};

export function isEmpty(piece: SquareContent): piece is typeof EMPTY {
  return piece === EMPTY;
}

export function isWhite(piece: SquareContent): piece is Piece {
  return !isEmpty(piece) && piece === piece.toUpperCase();
}

export function isBlack(piece: SquareContent): piece is Piece {
  return !isEmpty(piece) && piece === piece.toLowerCase();
}

export function displayPiece(piece: SquareContent): string {
  return DISPLAY[piece];
}

/** The glyph plus the text-presentation selector, ready to drop into a cell. */
export function renderPiece(piece: SquareContent): string {
  return isEmpty(piece) ? " " : `${DISPLAY[piece]}${TEXT_PRESENTATION}`;
}

export function isKing(piece: SquareContent): boolean {
  return piece.toLowerCase() === "k";
}

export function isPawn(piece: SquareContent): boolean {
  return piece.toLowerCase() === "p";
}

export function isRook(piece: SquareContent): boolean {
  return piece.toLowerCase() === "r";
}

export function isBishop(piece: SquareContent): boolean {
  return piece.toLowerCase() === "b";
}

export function isKnight(piece: SquareContent): boolean {
  return piece.toLowerCase() === "n";
}

export function isQueen(piece: SquareContent): boolean {
  return piece.toLowerCase() === "q";
}
