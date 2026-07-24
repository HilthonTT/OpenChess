import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PUZZLE_RATING,
  expectedSolveRate,
  puzzleRatingAfter,
  puzzleRatingBand,
} from "./puzzle-rating";

describe("expectedSolveRate", () => {
  test("an evenly matched puzzle is a coin flip", () => {
    expect(expectedSolveRate(1200, 1200)).toBeCloseTo(0.5, 6);
  });

  test("rises against an easier puzzle and falls against a harder one", () => {
    expect(expectedSolveRate(1600, 1200)).toBeGreaterThan(0.8);
    expect(expectedSolveRate(1200, 1600)).toBeLessThan(0.2);
  });
});

describe("puzzleRatingAfter", () => {
  test("a solve raises the rating and a failure lowers it", () => {
    const solved = puzzleRatingAfter({
      rating: 1200,
      puzzleRating: 1200,
      solved: true,
    });
    const failed = puzzleRatingAfter({
      rating: 1200,
      puzzleRating: 1200,
      solved: false,
    });

    expect(solved).toBeGreaterThan(1200);
    expect(failed).toBeLessThan(1200);
  });

  test("beating a hard puzzle pays more than beating an easy one", () => {
    const hard = puzzleRatingAfter({
      rating: 1200,
      puzzleRating: 1800,
      solved: true,
    });
    const easy = puzzleRatingAfter({
      rating: 1200,
      puzzleRating: 600,
      solved: true,
    });

    expect(hard - 1200).toBeGreaterThan(easy - 1200);
  });

  test("an all-but-certain solve still moves the number by a point", () => {
    expect(
      puzzleRatingAfter({ rating: 2500, puzzleRating: 400, solved: true }),
    ).toBeGreaterThan(2500);
  });

  test("a hinted solve counts for half", () => {
    const clean = puzzleRatingAfter({
      rating: 1200,
      puzzleRating: 1200,
      solved: true,
    });
    const hinted = puzzleRatingAfter({
      rating: 1200,
      puzzleRating: 1200,
      solved: true,
      hintUsed: true,
    });

    expect(hinted).toBeLessThan(clean);
    expect(hinted).toBe(1200);
  });

  test("never falls through the floor", () => {
    expect(
      puzzleRatingAfter({ rating: 100, puzzleRating: 3000, solved: false }),
    ).toBe(100);
  });

  test("a new player starts at the default", () => {
    expect(DEFAULT_PUZZLE_RATING).toBe(1000);
  });
});

describe("puzzleRatingBand", () => {
  test("brackets the player's rating", () => {
    const band = puzzleRatingBand(1200);

    expect(band.min).toBeLessThan(1200);
    expect(band.max).toBeGreaterThan(1200);
  });

  test("widens with each empty attempt so no rating is ever stranded", () => {
    const first = puzzleRatingBand(1200, 0);
    const third = puzzleRatingBand(1200, 2);

    expect(third.max - third.min).toBeGreaterThan(first.max - first.min);
  });
});
