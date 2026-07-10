import { describe, expect, test } from "bun:test";
import { parseFen, toAlgebraic } from "./board";
import { findBestMove } from "./ai";
import { applyMove, generateLegalMoves, isInCheck } from "./moves";
import type { Difficulty } from "./ai";

describe("findBestMove", () => {
  test("returns null when there is no legal move", () => {
    // Black is checkmated in the corner by the supported queen.
    const mated = parseFen("k7/1Q6/1K6/8/8/8/8/8 b - - 0 1");
    expect(findBestMove(mated, "hard")).toBeNull();
  });

  test("easy plays a legal move", () => {
    const position = parseFen(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );
    const move = findBestMove(position, "easy");
    expect(move).not.toBeNull();
    const legal = generateLegalMoves(position);
    expect(
      legal.some((m) => m.from === move?.from && m.to === move.to),
    ).toBe(true);
  });

  test("medium grabs a hanging queen", () => {
    // The black queen on d5 is free for the rook on d2.
    const position = parseFen("k7/8/8/3q4/8/8/3R4/K7 w - - 0 1");
    const move = findBestMove(position, "medium");
    expect(move).not.toBeNull();
    expect(toAlgebraic(move!.to)).toBe("d5");
  });

  test("hard finds a back-rank mate in one", () => {
    const position = parseFen("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1");
    const move = findBestMove(position, "hard");
    expect(move).not.toBeNull();

    const after = applyMove(position, move!);
    expect(generateLegalMoves(after)).toHaveLength(0);
    expect(isInCheck(after, "b")).toBe(true);
  });

  test("hard does not hang its queen to a pawn", () => {
    // Qxe5 would win a pawn but lose the queen to d6xe5.
    const position = parseFen(
      "k7/8/3p4/4p3/8/8/1Q6/K7 w - - 0 1",
    );
    const move = findBestMove(position, "hard");
    expect(move).not.toBeNull();
    expect(toAlgebraic(move!.to)).not.toBe("e5");
  });

  test("searching sides are symmetric: black also finds mate in one", () => {
    const position = parseFen("r6k/8/8/8/8/8/5PPP/6K1 b - - 0 1");
    const move = findBestMove(position, "hard");
    expect(move).not.toBeNull();

    const after = applyMove(position, move!);
    expect(generateLegalMoves(after)).toHaveLength(0);
    expect(isInCheck(after, "w")).toBe(true);
  });

  test("every difficulty answers within the opening", () => {
    const position = parseFen(
      "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    );
    for (const difficulty of ["easy", "medium", "hard"] as Difficulty[]) {
      expect(findBestMove(position, difficulty)).not.toBeNull();
    }
  });

  test("escapes check with a legal move", () => {
    // Black king on h8 is checked by the rook on a8; only Kg7 escapes.
    const position = parseFen("R6k/7p/8/8/8/8/8/7K b - - 0 1");
    const move = findBestMove(position, "hard");
    expect(move).not.toBeNull();
    expect(toAlgebraic(move!.from)).toBe("h8");
  });
});
