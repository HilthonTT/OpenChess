import type { SquareContent } from "@openchess/shared";
import { EMPTY } from "@openchess/shared";

export const TEXT_PRESENTATION = String.fromCharCode(0xfe0e);

export const PIECE_SETS = ["unicode", "letters"] as const;
export type PieceSet = (typeof PIECE_SETS)[number];

export const DEFAULT_PIECE_SET: PieceSet = "unicode";

export function isPieceSet(value: string): value is PieceSet {
  return (PIECE_SETS as readonly string[]).includes(value);
}

export const PIECE_SET_DESCRIPTIONS: Record<PieceSet, string> = {
  unicode: "Chess figurines — needs a font that carries them",
  letters: "K Q R B N P — readable in any font",
};

const UNICODE_PIECES: Record<SquareContent, string> = {
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

const LETTER_PIECES: Record<SquareContent, string> = {
  [EMPTY]: " ",
  B: "B",
  K: "K",
  N: "N",
  P: "P",
  Q: "Q",
  R: "R",
  b: "b",
  k: "k",
  n: "n",
  p: "p",
  q: "q",
  r: "r",
};

export function renderPiece(
  piece: SquareContent,
  set: PieceSet = DEFAULT_PIECE_SET,
): string {
  if (piece === EMPTY) {
    return " ";
  }

  if (set === "letters") {
    return LETTER_PIECES[piece];
  }

  return `${UNICODE_PIECES[piece]}${TEXT_PRESENTATION}`;
}
