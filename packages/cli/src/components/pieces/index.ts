import type { SquareContent } from "@openchess/shared";
import { EMPTY } from "@openchess/shared";

/**
 * Variation selector (U+FE0E) appended to a chess glyph to force text (not
 * emoji) presentation, so the terminal honors our `fg` color instead of
 * drawing the piece as a fixed-color emoji.
 *
 * Appended to every figurine rather than only to the ones Unicode gives an
 * emoji form. Narrowing it to those is not safe in practice: Windows Terminal
 * reaches for Segoe UI Emoji for more of this range than the emoji-presentation
 * tables say it should, and a symbol drawn from there arrives in its own colors
 * with our `fg` ignored.
 */
export const TEXT_PRESENTATION = String.fromCharCode(0xfe0e);

export const PIECE_SETS = ["unicode", "letters"] as const;
export type PieceSet = (typeof PIECE_SETS)[number];

export const DEFAULT_PIECE_SET: PieceSet = "unicode";

export function isPieceSet(value: string): value is PieceSet {
  return (PIECE_SETS as readonly string[]).includes(value);
}

/** What each set is for, shown in the picker and by `--pieces`. */
export const PIECE_SET_DESCRIPTIONS: Record<PieceSet, string> = {
  unicode: "Chess figurines — needs a font that carries them",
  letters: "K Q R B N P — readable in any font",
};

/**
 * Glyphs are chosen for contrast, not for the color they are named after: the
 * solid (nominally black) glyphs read as white pieces on a dark terminal, and
 * the hollow ones read as black. Both are painted with an explicit `fg`.
 */
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

/**
 * The set for terminals whose font has no chess pieces in it.
 *
 * Most monospace fonts do not — Cascadia Mono among them — so the terminal
 * borrows the figurines from whatever fallback font does, and a fallback glyph
 * that does not fit the cell is drawn clipped. Letters are in every font there
 * is, at the metrics the cell was measured for.
 *
 * Case carries the color the way a FEN does, so the board stays readable even
 * where the two `fg` colors are hard to tell apart.
 */
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

/** The glyph for `piece` in `set`, ready to drop into a cell. */
export function renderPiece(
  piece: SquareContent,
  set: PieceSet = DEFAULT_PIECE_SET,
): string {
  if (piece === EMPTY) {
    return " ";
  }

  // The letters are plain ASCII, with no emoji form for the selector to rule
  // out and no fallback font to be dragged into.
  if (set === "letters") {
    return LETTER_PIECES[piece];
  }

  return `${UNICODE_PIECES[piece]}${TEXT_PRESENTATION}`;
}
