import { describe, expect, test } from "bun:test";
import { createGame } from "./game";
import { parseFen } from "./board";
import {
  analyzePosition,
  centipawnLoss,
  classifyMove,
  evaluatePosition,
} from "./ai";
import {
  TIME_CONTROLS,
  formatClock,
  timeControlFor,
} from "./time-control";

describe("evaluatePosition", () => {
  test("the start position is level", () => {
    expect(evaluatePosition(createGame().position)).toBe(0);
  });

  test("is from white's point of view regardless of side to move", () => {
    // White is a whole queen up; the score is positive whoever is to move.
    const whiteToMove = parseFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    const blackToMove = parseFen("4k3/8/8/8/8/8/8/3QK3 b - - 0 1");

    expect(evaluatePosition(whiteToMove)).toBeGreaterThan(0);
    expect(evaluatePosition(blackToMove)).toBeGreaterThan(0);
  });
});

describe("analyzePosition", () => {
  test("finds a mate in one and reports it from white's POV", () => {
    // Back-rank mate: Ra8#.
    const position = parseFen("6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1");
    const analysis = analyzePosition(position);

    expect(analysis.mateIn).toBe(1);
    expect(analysis.scoreCp).toBeGreaterThan(0);
    expect(analysis.bestMove).not.toBeNull();
  });

  test("a checkmated side scores a decisive loss with no move", () => {
    // Fool's mate: white is mated, black to move is not — set white to move,
    // already mated.
    const mated = parseFen(
      "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
    );
    const analysis = analyzePosition(mated);

    expect(analysis.bestMove).toBeNull();
    expect(analysis.scoreCp).toBeLessThan(0);
  });

  test("a stalemate is a draw, not a loss", () => {
    const position = parseFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    const analysis = analyzePosition(position);

    expect(analysis.bestMove).toBeNull();
    expect(analysis.scoreCp).toBe(0);
    expect(analysis.mateIn).toBeNull();
  });
});

describe("centipawnLoss", () => {
  test("white handing back an edge counts as a loss", () => {
    // White was +200, drops to +50 after the move: 150 given up.
    expect(centipawnLoss("w", 200, 50)).toBe(150);
  });

  test("black is measured on the same white-POV axis, inverted", () => {
    // Black was -200 (winning), lets it slip to -50: 150 given up.
    expect(centipawnLoss("b", -200, -50)).toBe(150);
  });

  test("a move that improves the position loses nothing", () => {
    expect(centipawnLoss("w", 50, 200)).toBe(0);
    expect(centipawnLoss("b", -50, -200)).toBe(0);
  });
});

describe("classifyMove", () => {
  test("bands the loss into labels", () => {
    expect(classifyMove(0)).toBe("best");
    expect(classifyMove(20)).toBe("best");
    expect(classifyMove(40)).toBe("good");
    expect(classifyMove(100)).toBe("inaccuracy");
    expect(classifyMove(200)).toBe("mistake");
    expect(classifyMove(600)).toBe("blunder");
  });
});

describe("time controls", () => {
  test("names a stored clock back into its preset", () => {
    const blitz = TIME_CONTROLS.blitz;
    expect(timeControlFor(blitz.initialSeconds, blitz.incrementSeconds)).toBe(
      blitz,
    );
  });

  test("an unknown clock has no preset", () => {
    expect(timeControlFor(42, 7)).toBeNull();
  });

  test("formatClock reads minutes above ten seconds and tenths below", () => {
    expect(formatClock(125_000)).toBe("2:05");
    expect(formatClock(9_400)).toBe("9.4");
    expect(formatClock(60_000)).toBe("1:00");
    expect(formatClock(-500)).toBe("0.0");
  });
});
