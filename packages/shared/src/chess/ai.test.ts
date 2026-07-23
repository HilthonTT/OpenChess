import { describe, expect, test } from "bun:test";
import { parseFen, toAlgebraic } from "./board";
import { analyzePosition, findBestMove } from "./ai";
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

/**
 * The horizon effect, which is what `quiescence` exists to remove: a search that
 * stops counting mid-exchange banks the first capture and never sees the
 * recapture that refutes it. Each position here is losing for the side to move
 * only once the exchange is played out past the fixed depth.
 */
describe("quiescence", () => {
  test("declines a capture that loses the exchange", () => {
    // Rxd5 wins a knight but the c6 pawn recaptures: a rook for a knight down.
    // A depth-3 search without quiescence stops on the knight and plays it.
    const position = parseFen("k7/8/2p5/3n4/8/8/3R4/K7 w - - 0 1");
    const move = findBestMove(position, "hard");

    expect(move).not.toBeNull();
    expect(toAlgebraic(move!.to)).not.toBe("d5");
  });

  test("takes a capture that the recapture cannot punish", () => {
    // The same shape with the defending pawn gone: Rxd5 is simply a free knight.
    const position = parseFen("k7/8/8/3n4/8/8/3R4/K7 w - - 0 1");
    const move = findBestMove(position, "hard");

    expect(move).not.toBeNull();
    expect(toAlgebraic(move!.to)).toBe("d5");
  });

  test("sees the full exchange on a contested square", () => {
    // Black's rook on d5 is defended by the c6 pawn; white's rook is backed by
    // the d1 rook. Rxd5 cxd5 Rxd5 nets a rook and a pawn for a rook — winning —
    // but only a search that plays the sequence out can tell.
    const position = parseFen("k7/8/2p5/3r4/8/8/3R4/K2R4 w - - 0 1");
    const move = findBestMove(position, "hard");

    expect(move).not.toBeNull();
    expect(toAlgebraic(move!.to)).toBe("d5");
  });

  test("a quiet position still evaluates without extending forever", () => {
    // No captures available at all: quiescence must stand pat immediately
    // rather than recurse. Guards the cap and the stalemate probe.
    const position = parseFen("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
    expect(findBestMove(position, "hard")).not.toBeNull();
  });

  test("scores a stalemate at the horizon as a draw, not a rout", () => {
    // Black is stalemated and has no captures. Reading "no captures" as a quiet
    // position would score white's extra queen instead of the draw.
    const stalemate = parseFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(analyzePosition(stalemate).scoreCp).toBe(0);
  });

  test("still finds mate rather than chasing material", () => {
    // Ra8 is mate — the king is walled in by its own pawns and the knight on d1
    // reaches no square on the eighth rank to block with. Rxd1 merely wins that
    // knight. A capture search that lost sight of mate would grab the piece.
    const position = parseFen("7k/6pp/8/8/8/8/8/R2n2K1 w - - 0 1");
    const analysis = analyzePosition(position);

    expect(analysis.mateIn).toBe(1);
    expect(analysis.bestMove).not.toBeNull();
    expect(toAlgebraic(analysis.bestMove!.to)).toBe("a8");
  });
});
