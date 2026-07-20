import type { SquareContent } from "@openchess/shared";
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

/** The glyph plus the text-presentation selector, ready to drop into a cell. */
export function renderPiece(piece: SquareContent): string {
  return piece === EMPTY ? " " : `${DISPLAY[piece]}${TEXT_PRESENTATION}`;
}
