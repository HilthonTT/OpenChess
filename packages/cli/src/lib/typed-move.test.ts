import { describe, expect, test } from "bun:test";
import { createGame, fromAlgebraic, playSan } from "@openchess/shared";
import type { Game } from "@openchess/shared";
import { parseCoordinates, resolveTypedMove } from "./typed-move";

function square(name: string): number {
  const index = fromAlgebraic(name);
  if (index === null) {
    throw new Error(`Not a square: ${name}`);
  }
  return index;
}

function after(...sans: string[]): Game {
  return sans.reduce(playSan, createGame());
}

function played(game: Game, text: string) {
  const result = resolveTypedMove(game, text);
  if (result.kind === "error") {
    throw new Error(result.message);
  }
  return result.move;
}

describe("parseCoordinates", () => {
  test("reads two squares, with or without a separator", () => {
    for (const text of ["e2e4", "e2-e4", "E2E4", " e2e4 "]) {
      expect(parseCoordinates(text)).toEqual({
        from: square("e2"),
        to: square("e4"),
      });
    }
  });

  test("keeps a promotion suffix", () => {
    expect(parseCoordinates("e7e8q")).toEqual({
      from: square("e7"),
      to: square("e8"),
      promotion: "q",
    });
  });

  test("turns down anything that isn't two squares", () => {
    for (const text of ["e4", "Nf3", "e9e4", "e2e4k", ""]) {
      expect(parseCoordinates(text)).toBeNull();
    }
  });
});

describe("resolveTypedMove", () => {
  test("plays SAN and coordinates alike", () => {
    const game = createGame();
    const expected = { from: square("g1"), to: square("f3") };

    expect(played(game, "Nf3")).toEqual(expected);
    expect(played(game, "g1f3")).toEqual(expected);
  });

  test("forgives lowercase piece letters", () => {
    expect(played(createGame(), "nf3")).toEqual({
      from: square("g1"),
      to: square("f3"),
    });
  });

  test("reads a lowercase b as a pawn first, then as a bishop", () => {
    const pawn = after("e4", "d5", "c4", "e5", "b3", "Nf6");
    expect(played(pawn, "b4")).toEqual({
      from: square("b3"),
      to: square("b4"),
    });

    const bishop = after("e4", "e5");
    expect(played(bishop, "bc4")).toEqual({
      from: square("f1"),
      to: square("c4"),
    });
  });

  test("castles from O-O, 0-0 or o-o", () => {
    const game = after("e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6");
    for (const text of ["O-O", "0-0", "o-o"]) {
      expect(played(game, text)).toEqual({
        from: square("e1"),
        to: square("g1"),
      });
    }
  });

  test("ignores check marks", () => {
    const game = after("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6");
    expect(played(game, "Qxf7#")).toEqual({
      from: square("h5"),
      to: square("f7"),
    });
  });

  test("carries the promotion piece, however it is spelled", () => {
    const game = createGame("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    for (const text of ["e8=Q", "e8q", "e8=q", "e7e8q"]) {
      expect(played(game, text)).toEqual({
        from: square("e7"),
        to: square("e8"),
        promotion: "q",
      });
    }
  });

  test("leaves a coordinate promotion open for the caller to ask", () => {
    const game = createGame("8/4P3/8/8/8/8/k7/4K3 w - - 0 1");
    expect(played(game, "e7e8")).toEqual({
      from: square("e7"),
      to: square("e8"),
    });
  });

  test("says why when nothing matches", () => {
    const empty = resolveTypedMove(createGame(), "  ");
    expect(empty.kind).toBe("error");

    const illegal = resolveTypedMove(createGame(), "e5");
    expect(illegal).toEqual({
      kind: "error",
      message: "“e5” isn't a legal move here",
    });
  });
});
