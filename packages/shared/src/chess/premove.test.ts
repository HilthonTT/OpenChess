import { describe, expect, test } from "bun:test";
import { fromAlgebraic, parseFen, toAlgebraic } from "./board";
import { createGame, play } from "./game";
import { playSan } from "./pgn";
import {
  describePremove,
  premoveNeedsPromotion,
  premoveTargets,
  resolvePremove,
} from "./premove";
import type { Color } from "./types";

function square(name: string): number {
  const index = fromAlgebraic(name);
  if (index === null) {
    throw new Error(`Not a square: ${name}`);
  }
  return index;
}

function targets(fen: string, from: string, color: Color): string[] {
  return premoveTargets(parseFen(fen), square(from), color)
    .map((move) => toAlgebraic(move.to))
    .sort();
}

describe("premoveTargets", () => {
  test("offers a knight every square its pattern reaches", () => {
    expect(targets("8/8/8/3N4/8/8/8/K6k w - - 0 1", "d5", "w")).toEqual(
      ["b4", "b6", "c3", "c7", "e3", "e7", "f4", "f6"].sort(),
    );
  });

  test("lets a slider run through pieces that may yet move", () => {
    const found = targets("8/8/8/8/8/8/1P6/RP5k w - - 0 1", "a1", "w");
    expect(found).toContain("a8");
    expect(found).toContain("h1");
  });

  test("offers a recapture onto a square one of your own pieces still holds", () => {
    const found = targets(
      "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      "e4",
      "w",
    );
    expect(found).toContain("d5");
    expect(found).toContain("f5");
  });

  test("offers a pawn capture onto an empty square", () => {
    expect(targets("8/8/8/8/4P3/8/8/K6k w - - 0 1", "e4", "w")).toEqual(
      ["d5", "e5", "f5"].sort(),
    );
  });

  test("offers the double push only from the pawn's own rank", () => {
    expect(targets("8/8/8/8/8/8/4P3/K6k w - - 0 1", "e2", "w")).toContain("e4");
    expect(targets("8/8/8/8/8/4P3/8/K6k w - - 0 1", "e3", "w")).not.toContain(
      "e5",
    );
  });

  test("offers castling while the king still holds the right", () => {
    expect(
      targets("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "w"),
    ).toContain("g1");
    expect(
      targets("r3k2r/8/8/8/8/8/8/R3K2R w kq - 0 1", "e1", "w"),
    ).not.toContain("g1");
  });

  test("says nothing about a square that is empty or somebody else's", () => {
    expect(targets("8/8/8/3N4/8/8/8/K6k w - - 0 1", "d4", "w")).toEqual([]);
    expect(targets("8/8/8/3N4/8/8/8/K6k w - - 0 1", "d5", "b")).toEqual([]);
  });
});

describe("premoveNeedsPromotion", () => {
  const position = parseFen("8/4P3/8/8/8/8/8/K6k w - - 0 1");

  test("is true for a pawn reaching the last rank", () => {
    expect(
      premoveNeedsPromotion(position, square("e7"), square("e8"), "w"),
    ).toBe(true);
  });

  test("is false for the same pawn one rank short", () => {
    const short = parseFen("8/8/4P3/8/8/8/8/K6k w - - 0 1");
    expect(premoveNeedsPromotion(short, square("e6"), square("e7"), "w")).toBe(
      false,
    );
  });
});

describe("resolvePremove", () => {
  test("plays once the position makes the move legal", () => {
    const game = playSan(createGame(), "e4");
    const premove = { from: square("d7"), to: square("d5"), promotion: null };

    const move = resolvePremove(game, premove);
    expect(move).toBeDefined();
    expect(() => play(game, move!)).not.toThrow();
  });

  test("is discarded when the opponent's move made it illegal", () => {
    const game = playSan(createGame(), "e4");
    const blocked = { from: square("d7"), to: square("d4"), promotion: null };

    expect(resolvePremove(game, blocked)).toBeUndefined();
  });

  test("carries the promotion choice through", () => {
    const game = createGame("8/4P3/8/8/8/8/8/K6k w - - 0 1");

    expect(
      resolvePremove(game, {
        from: square("e7"),
        to: square("e8"),
        promotion: "n",
      })?.promotion,
    ).toBe("n");
  });
});

describe("describePremove", () => {
  test("names the squares, and the promotion when there is one", () => {
    expect(
      describePremove({
        from: square("e2"),
        to: square("e4"),
        promotion: null,
      }),
    ).toBe("e2e4");
    expect(
      describePremove({ from: square("e7"), to: square("e8"), promotion: "q" }),
    ).toBe("e7e8q");
  });
});
