import { describe, expect, test } from "bun:test";
import { EMPTY, type SquareContent } from "@openchess/shared";
import { PIECE_SETS, TEXT_PRESENTATION, renderPiece } from "./index";

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

const SIGHTED_SETS = PIECE_SETS.filter((set) => set !== "blindfold");

describe("renderPiece", () => {
  test("an empty square is a space in every set", () => {
    for (const set of PIECE_SETS) {
      expect(renderPiece(EMPTY, set)).toBe(" ");
    }
  });

  test("every figurine carries the text-presentation selector", () => {
    for (const piece of PIECES) {
      expect(renderPiece(piece, "unicode")).toEndWith(TEXT_PRESENTATION);
    }
  });

  test("the unicode set draws figurines", () => {
    expect(renderPiece("N", "unicode")).toBe(`♘${TEXT_PRESENTATION}`);
    expect(renderPiece("n", "unicode")).toBe(`♘${TEXT_PRESENTATION}`);
  });

  test("the unicode set never draws the emoji pawn", () => {
    for (const piece of PIECES) {
      expect(renderPiece(piece, "unicode")).not.toContain("♟");
    }
  });

  test("the letters set spells the piece, with case for the color", () => {
    expect(renderPiece("K", "letters")).toBe("K");
    expect(renderPiece("N", "letters")).toBe("N");
    expect(renderPiece("k", "letters")).toBe("k");
    expect(renderPiece("n", "letters")).toBe("n");
  });

  test("the letters set carries no variation selector", () => {
    for (const piece of PIECES) {
      expect(renderPiece(piece, "letters")).not.toContain(TEXT_PRESENTATION);
    }
  });

  test("every sighted set draws every piece as something visible", () => {
    for (const set of SIGHTED_SETS) {
      for (const piece of PIECES) {
        expect(renderPiece(piece, set).trim()).not.toBe("");
      }
    }
  });

  test("no sighted set draws two kinds of piece the same", () => {
    const sides = [PIECES.slice(0, 6), PIECES.slice(6)];
    for (const set of SIGHTED_SETS) {
      for (const side of sides) {
        const drawn = side.map((piece) => renderPiece(piece, set));
        expect(new Set(drawn).size).toBe(side.length);
      }
    }
  });

  test("the blindfold set hides every piece, one column wide", () => {
    for (const piece of PIECES) {
      expect(renderPiece(piece, "blindfold")).toBe(" ");
    }
  });

  test("defaults to the unicode set", () => {
    expect(renderPiece("N")).toBe(renderPiece("N", "unicode"));
  });
});
