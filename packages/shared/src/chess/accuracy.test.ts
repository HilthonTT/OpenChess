import { describe, expect, test } from "bun:test";

import {
  buildGameReport,
  clampEval,
  mistakes,
  moveAccuracy,
  winningChance,
  type AnalyzedPly,
} from "./accuracy";

function ply(overrides: Partial<AnalyzedPly> = {}): AnalyzedPly {
  return {
    mover: "w",
    san: "e4",
    before: 0,
    after: 0,
    mateInvolved: false,
    ...overrides,
  };
}

describe("winningChance", () => {
  test("a level position is an even game", () => {
    expect(winningChance(0)).toBeCloseTo(50, 6);
  });

  test("rises with white's advantage and falls with black's", () => {
    expect(winningChance(300)).toBeGreaterThan(70);
    expect(winningChance(-300)).toBeLessThan(30);
  });

  // The whole reason accuracy is scored on this axis rather than on centipawns.
  test("a pawn is worth more when the game is level than when it is won", () => {
    const nearLevel = winningChance(0) - winningChance(-100);
    const alreadyWon = winningChance(900) - winningChance(800);

    expect(nearLevel).toBeGreaterThan(alreadyWon * 3);
  });
});

describe("moveAccuracy", () => {
  test("a move that costs nothing is near perfect", () => {
    expect(moveAccuracy(0)).toBeGreaterThan(99);
  });

  test("never leaves the 0–100 range, however bad the move", () => {
    expect(moveAccuracy(100)).toBe(0);
    expect(moveAccuracy(1_000)).toBe(0);
  });

  test("falls as more of the game is thrown away", () => {
    expect(moveAccuracy(5)).toBeGreaterThan(moveAccuracy(20));
    expect(moveAccuracy(20)).toBeGreaterThan(moveAccuracy(50));
  });
});

describe("buildGameReport", () => {
  test("scores each side only on its own moves", () => {
    const report = buildGameReport([
      ply({ mover: "w", san: "e4", before: 0, after: 20 }),
      // Black hands over three pawns.
      ply({ mover: "b", san: "g5", before: 20, after: 320 }),
    ]);

    expect(report.white.moves).toBe(1);
    expect(report.black.moves).toBe(1);
    expect(report.white.counts.best).toBe(1);
    expect(report.black.counts.blunder).toBe(1);
    expect(report.white.accuracy).toBeGreaterThan(report.black.accuracy);
  });

  test("a move that improves the position loses nothing", () => {
    const report = buildGameReport([
      ply({ mover: "w", before: 0, after: 150 }),
    ]);

    expect(report.plies[0]!.loss).toBe(0);
    expect(report.white.averageLoss).toBe(0);
  });

  test("numbers the plies from one, in order", () => {
    const report = buildGameReport([
      ply({ mover: "w", san: "e4" }),
      ply({ mover: "b", san: "e5" }),
      ply({ mover: "w", san: "Nf3" }),
    ]);

    expect(report.plies.map((entry) => entry.ply)).toEqual([1, 2, 3]);
    expect(report.plies.map((entry) => entry.san)).toEqual([
      "e4",
      "e5",
      "Nf3",
    ]);
  });

  // Without the clamp, converting a won game into a merely-winning one would
  // read as a hundred-pawn catastrophe.
  test("clamps mate-sized scores onto the pawn axis", () => {
    const report = buildGameReport([
      ply({ mover: "w", before: 100_000, after: 900, mateInvolved: true }),
    ]);

    expect(report.plies[0]!.loss).toBe(EVAL_CLAMP_EXPECTED - 900);
    expect(report.plies[0]!.lossIsExact).toBe(false);
  });

  test("a side that never moved is not penalised for it", () => {
    const report = buildGameReport([ply({ mover: "w" })]);

    expect(report.black.moves).toBe(0);
    expect(report.black.accuracy).toBe(100);
    expect(report.black.averageLoss).toBe(0);
  });

  test("an empty game reports both sides perfect", () => {
    const report = buildGameReport([]);

    expect(report.white.accuracy).toBe(100);
    expect(report.black.accuracy).toBe(100);
    expect(report.plies).toEqual([]);
  });
});

const EVAL_CLAMP_EXPECTED = 1000;

describe("clampEval", () => {
  test("holds scores to the pawn axis in both directions", () => {
    expect(clampEval(50_000)).toBe(EVAL_CLAMP_EXPECTED);
    expect(clampEval(-50_000)).toBe(-EVAL_CLAMP_EXPECTED);
    expect(clampEval(250)).toBe(250);
  });
});

describe("mistakes", () => {
  const report = buildGameReport([
    ply({ mover: "w", san: "e4", before: 0, after: 10 }),
    ply({ mover: "b", san: "g5", before: 10, after: 400 }),
    ply({ mover: "w", san: "Nf3", before: 400, after: 250 }),
  ]);

  test("lists everything worse than good, in order", () => {
    expect(mistakes(report).map((entry) => entry.san)).toEqual(["g5", "Nf3"]);
  });

  test("filters to one side when asked", () => {
    expect(mistakes(report, { side: "b" }).map((entry) => entry.san)).toEqual([
      "g5",
    ]);
  });
});
