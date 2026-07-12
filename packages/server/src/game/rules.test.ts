import { describe, expect, test } from "bun:test";

import {
  MIN_REWARDED_PLIES,
  expectedScore,
  outcomeFor,
  ratingAfter,
  resultFor,
  resultForResignation,
  rewardFor,
  statsAfter,
} from "./rules";

const LONG_ENOUGH = MIN_REWARDED_PLIES + 2;

describe("resultFor", () => {
  // The side *to move* in a checkmated position is the side that has been mated.
  test("checkmate scores against the side to move", () => {
    expect(resultFor("checkmate", "w")).toBe("BLACK_WIN");
    expect(resultFor("checkmate", "b")).toBe("WHITE_WIN");
  });

  test("every drawn status is a draw", () => {
    expect(resultFor("stalemate", "w")).toBe("DRAW");
    expect(resultFor("draw-repetition", "w")).toBe("DRAW");
    expect(resultFor("draw-fifty-move", "b")).toBe("DRAW");
    expect(resultFor("draw-insufficient-material", "b")).toBe("DRAW");
  });

  test("a live game has no result", () => {
    expect(resultFor("playing", "w")).toBeNull();
    expect(resultFor("check", "b")).toBeNull();
  });
});

describe("resultForResignation", () => {
  test("the other side wins", () => {
    expect(resultForResignation("w")).toBe("BLACK_WIN");
    expect(resultForResignation("b")).toBe("WHITE_WIN");
  });
});

describe("outcomeFor", () => {
  test("reads the result from the player's side of the board", () => {
    expect(outcomeFor("WHITE_WIN", "w")).toBe("win");
    expect(outcomeFor("WHITE_WIN", "b")).toBe("loss");
    expect(outcomeFor("BLACK_WIN", "b")).toBe("win");
    expect(outcomeFor("DRAW", "w")).toBe("draw");
  });

  test("an abort is not an outcome at all", () => {
    expect(outcomeFor("ABORTED", "w")).toBeNull();
  });
});

describe("rewardFor", () => {
  test("a win pays more on a harder bot", () => {
    const easy = rewardFor({
      result: "WHITE_WIN",
      color: "w",
      difficulty: "EASY",
      plies: LONG_ENOUGH,
    });
    const hard = rewardFor({
      result: "WHITE_WIN",
      color: "w",
      difficulty: "HARD",
      plies: LONG_ENOUGH,
    });

    expect(hard.xp).toBeGreaterThan(easy.xp);
    expect(hard.coins).toBeGreaterThan(easy.coins);
  });

  test("a loss pays consolation XP but never coins", () => {
    const reward = rewardFor({
      result: "BLACK_WIN",
      color: "w",
      difficulty: "HARD",
      plies: LONG_ENOUGH,
    });

    expect(reward.xp).toBeGreaterThan(0);
    // Coins on a loss would make resign-farming profitable.
    expect(reward.coins).toBe(0);
  });

  test("an abort pays nothing", () => {
    expect(
      rewardFor({
        result: "ABORTED",
        color: "w",
        difficulty: "HARD",
        plies: LONG_ENOUGH,
      }),
    ).toEqual({ xp: 0, coins: 0 });
  });

  // The anti-farm floor: start, resign, repeat must be worth exactly zero.
  test("a game too short to be a game pays nothing, even a won one", () => {
    expect(
      rewardFor({
        result: "WHITE_WIN",
        color: "w",
        difficulty: "HARD",
        plies: MIN_REWARDED_PLIES - 1,
      }),
    ).toEqual({ xp: 0, coins: 0 });
  });

  test("the floor is inclusive", () => {
    const reward = rewardFor({
      result: "WHITE_WIN",
      color: "w",
      difficulty: "EASY",
      plies: MIN_REWARDED_PLIES,
    });

    expect(reward.xp).toBeGreaterThan(0);
  });
});

describe("expectedScore", () => {
  test("evenly matched players expect a half point", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5);
  });

  test("the favourite expects more", () => {
    expect(expectedScore(1600, 800)).toBeGreaterThan(0.9);
    expect(expectedScore(800, 1600)).toBeLessThan(0.1);
  });
});

describe("ratingAfter", () => {
  test("beating a stronger bot gains more than beating a weaker one", () => {
    const overHard = ratingAfter(1200, "win", "HARD") - 1200;
    const overEasy = ratingAfter(1200, "win", "EASY") - 1200;

    expect(overHard).toBeGreaterThan(overEasy);
  });

  test("a win never loses rating and a loss never gains it", () => {
    expect(ratingAfter(1200, "win", "EASY")).toBeGreaterThan(1200);
    expect(ratingAfter(1200, "loss", "HARD")).toBeLessThan(1200);
  });

  test("rating has a floor, so a losing streak cannot go negative", () => {
    let rating = 150;
    for (let i = 0; i < 50; i++) {
      rating = ratingAfter(rating, "loss", "HARD");
    }

    expect(rating).toBeGreaterThanOrEqual(100);
  });
});

describe("statsAfter", () => {
  const before = {
    wins: 4,
    losses: 1,
    draws: 0,
    currentWinStreak: 4,
    topWinStreak: 4,
    rating: 1200,
  };

  test("a win extends the streak and the record", () => {
    const after = statsAfter(before, "win", "MEDIUM");

    expect(after.wins).toBe(5);
    expect(after.currentWinStreak).toBe(5);
    expect(after.topWinStreak).toBe(5);
  });

  test("a loss breaks the streak but leaves the best one standing", () => {
    const after = statsAfter(before, "loss", "MEDIUM");

    expect(after.losses).toBe(2);
    expect(after.currentWinStreak).toBe(0);
    expect(after.topWinStreak).toBe(4);
  });

  // Ported from the streak rule in the original draft: a repetition should not
  // cost a player a streak they never lost.
  test("a draw neither extends nor breaks the streak", () => {
    const after = statsAfter(before, "draw", "MEDIUM");

    expect(after.draws).toBe(1);
    expect(after.currentWinStreak).toBe(4);
    expect(after.topWinStreak).toBe(4);
  });
});
