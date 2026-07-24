import { describe, expect, test } from "bun:test";

import {
  difficultyMultiplier,
  puzzleReward,
  puzzleStreakAfter,
  ratingAfterAttempt,
  toPuzzleView,
} from "./rules";

const ROW = {
  id: "p1",
  fen: "6k1/7p/6K1/8/8/8/8/R7 b - - 0 1",
  moves: ["h7h6", "a1a8"],
  rating: 1000,
  themes: ["mateIn1"],
  sourceUrl: null,
  dailyOn: null,
};

describe("difficultyMultiplier", () => {
  test("is one at the solver's own rating", () => {
    expect(difficultyMultiplier(1200, 1200)).toBe(1);
  });

  test("is bounded at both ends", () => {
    expect(difficultyMultiplier(3000, 100)).toBe(2);
    expect(difficultyMultiplier(100, 3000)).toBe(0.25);
  });
});

describe("puzzleReward", () => {
  test("a solve pays, scaled by how hard the puzzle was", () => {
    const easy = puzzleReward({
      solved: true,
      hintUsed: false,
      puzzleRating: 800,
      solverRating: 1200,
      scored: true,
    });
    const hard = puzzleReward({
      solved: true,
      hintUsed: false,
      puzzleRating: 1600,
      solverRating: 1200,
      scored: true,
    });

    expect(hard.coins).toBeGreaterThan(easy.coins);
    expect(easy.coins).toBeGreaterThan(0);
  });

  // Unlike a lost game, which pays a consolation: a puzzle can be failed
  // deliberately in one keystroke.
  test("a failure pays nothing at all", () => {
    expect(
      puzzleReward({
        solved: false,
        hintUsed: false,
        puzzleRating: 1600,
        solverRating: 1200,
        scored: true,
      }),
    ).toEqual({ xp: 0, coins: 0 });
  });

  test("a replay of an already-scored puzzle pays nothing", () => {
    expect(
      puzzleReward({
        solved: true,
        hintUsed: false,
        puzzleRating: 1600,
        solverRating: 1200,
        scored: false,
      }),
    ).toEqual({ xp: 0, coins: 0 });
  });

  test("a hinted solve pays half", () => {
    const clean = puzzleReward({
      solved: true,
      hintUsed: false,
      puzzleRating: 1200,
      solverRating: 1200,
      scored: true,
    });
    const hinted = puzzleReward({
      solved: true,
      hintUsed: true,
      puzzleRating: 1200,
      solverRating: 1200,
      scored: true,
    });

    expect(hinted.xp).toBeLessThan(clean.xp);
    expect(hinted.xp).toBeGreaterThan(0);
  });
});

describe("ratingAfterAttempt", () => {
  test("a replay leaves the rating exactly where it was", () => {
    expect(
      ratingAfterAttempt({
        rating: 1200,
        puzzleRating: 1900,
        solved: true,
        hintUsed: false,
        scored: false,
      }),
    ).toBe(1200);
  });

  test("a scored solve moves it", () => {
    expect(
      ratingAfterAttempt({
        rating: 1200,
        puzzleRating: 1200,
        solved: true,
        hintUsed: false,
        scored: true,
      }),
    ).toBeGreaterThan(1200);
  });
});

describe("puzzleStreakAfter", () => {
  test("a solve extends it and anything else ends it", () => {
    expect(puzzleStreakAfter(4, true)).toBe(5);
    expect(puzzleStreakAfter(4, false)).toBe(0);
  });
});

describe("toPuzzleView", () => {
  const view = toPuzzleView(ROW, { attempted: false, daily: false });

  // The point of the view existing at all.
  test("carries the opening move and nothing else of the line", () => {
    expect(view.openingMove).toBe("h7h6");
    expect(JSON.stringify(view)).not.toContain("a1a8");
  });

  test("counts the moves the solver has to find", () => {
    expect(view.solverMoves).toBe(1);
    expect(
      toPuzzleView(
        { ...ROW, moves: ["a7a6", "a2a8", "d8a8", "a1a8"] },
        { attempted: false, daily: false },
      ).solverMoves,
    ).toBe(2);
  });
});
