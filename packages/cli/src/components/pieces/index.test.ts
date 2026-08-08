import { describe, expect, test } from "bun:test";
import { EMPTY, type SquareContent } from "@openchess/shared";
import { PIECE_SETS, TEXT_PRESENTATION, renderPiece } from "./index";

/** Every piece there is, both colors. */
const PIECES: SquareContent[] = [
  "K",
  "Q",
  "R",
  "B",
  "N",
  "P",
  "k",
  "q",
  "r",
  "b",
  "n",
  "p",
];

describe("renderPiece", () => {
  test("an empty square is a space in every set", () => {
    for (const set of PIECE_SETS) {
      expect(renderPiece(EMPTY, set)).toBe(" ");
    }
  });

  test("every figurine carries the text-presentation selector", () => {
    // Without it Windows Terminal draws several of these from Segoe UI Emoji,
    // in the emoji's own colors, and the theme's `fg` is ignored.
    for (const piece of PIECES) {
      expect(renderPiece(piece, "unicode")).toEndWith(TEXT_PRESENTATION);
    }
  });

  test("the unicode set draws figurines", () => {
    expect(renderPiece("N", "unicode")).toBe(`♞${TEXT_PRESENTATION}`);
    expect(renderPiece("n", "unicode")).toBe(`♘${TEXT_PRESENTATION}`);
  });

  test("the letters set spells the piece, with case for the color", () => {
    expect(renderPiece("K", "letters")).toBe("K");
    expect(renderPiece("N", "letters")).toBe("N");
    expect(renderPiece("k", "letters")).toBe("k");
    expect(renderPiece("n", "letters")).toBe("n");
  });

  test("the letters set carries no variation selector", () => {
    // The whole point of it is to be what a font without chess glyphs can draw,
    // so nothing here should reach for a fallback font.
    for (const piece of PIECES) {
      expect(renderPiece(piece, "letters")).not.toContain(TEXT_PRESENTATION);
    }
  });

  test("every set draws every piece as something visible", () => {
    for (const set of PIECE_SETS) {
      for (const piece of PIECES) {
        expect(renderPiece(piece, set).trim()).not.toBe("");
      }
    }
  });

  test("no set draws two pieces the same", () => {
    // A board where the rook and the queen share a glyph is unreadable, which
    // is the failure this whole setting exists to avoid.
    for (const set of PIECE_SETS) {
      const drawn = PIECES.map((piece) => renderPiece(piece, set));
      expect(new Set(drawn).size).toBe(PIECES.length);
    }
  });

  test("defaults to the unicode set", () => {
    expect(renderPiece("N")).toBe(renderPiece("N", "unicode"));
  });
});
