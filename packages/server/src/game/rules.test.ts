import { describe, expect, test } from "bun:test";

import {
  MIN_REWARDED_PLIES,
  clockAfterMove,
  expectedScore,
  hasFlagged,
  outcomeFor,
  ratingAfter,
  ratingAgainst,
  resultFor,
  resultForResignation,
  resultForTimeout,
  rewardFor,
  rewardForPvp,
  statsAfter,
  timeOf,
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

describe("ratingAgainst", () => {
  test("beating a stronger opponent gains more than beating a weaker one", () => {
    const overStronger = ratingAgainst(1200, 1600, "win") - 1200;
    const overWeaker = ratingAgainst(1200, 800, "win") - 1200;

    expect(overStronger).toBeGreaterThan(overWeaker);
  });

  test("a win never loses rating and a loss never gains it", () => {
    expect(ratingAgainst(1200, 800, "win")).toBeGreaterThan(1200);
    expect(ratingAgainst(1200, 1600, "loss")).toBeLessThan(1200);
  });

  test("rating has a floor, so a losing streak cannot go negative", () => {
    let rating = 150;
    for (let i = 0; i < 50; i++) {
      rating = ratingAgainst(rating, 1600, "loss");
    }

    expect(rating).toBeGreaterThanOrEqual(100);
  });

  test("Elo is zero-sum between evenly matched players, give or take rounding", () => {
    const winnerGain = ratingAgainst(1200, 1200, "win") - 1200;
    const loserDrop = 1200 - ratingAgainst(1200, 1200, "loss");

    expect(winnerGain).toBe(loserDrop);
  });
});

describe("ratingAfter", () => {
  // The flag flipped when online 1v1 landed: rating is strictly PvP now.
  test("an AI game no longer moves rating at all", () => {
    expect(ratingAfter(1200, "win", "HARD")).toBe(1200);
    expect(ratingAfter(1200, "loss", "EASY")).toBe(1200);
    expect(ratingAfter(1200, "draw", "MEDIUM")).toBe(1200);
  });
});

describe("rewardForPvp", () => {
  test("a win pays more than a hard bot does", () => {
    const bot = rewardFor({
      result: "WHITE_WIN",
      color: "w",
      difficulty: "HARD",
      plies: LONG_ENOUGH,
    });
    const human = rewardForPvp({
      result: "WHITE_WIN",
      color: "w",
      plies: LONG_ENOUGH,
    });

    expect(human.xp).toBeGreaterThan(bot.xp);
    expect(human.coins).toBeGreaterThan(bot.coins);
  });

  test("a loss pays consolation XP but never coins", () => {
    const reward = rewardForPvp({
      result: "BLACK_WIN",
      color: "w",
      plies: LONG_ENOUGH,
    });

    expect(reward.xp).toBeGreaterThan(0);
    expect(reward.coins).toBe(0);
  });

  // A coin-paying draw is a collusion faucet: equal ratings draw for exactly
  // zero Elo movement, so two accounts could farm repetitions forever.
  test("a draw pays XP but never coins", () => {
    const reward = rewardForPvp({
      result: "DRAW",
      color: "w",
      plies: LONG_ENOUGH,
    });

    expect(reward.xp).toBeGreaterThan(0);
    expect(reward.coins).toBe(0);
  });

  test("the anti-farm floor applies to PvP too", () => {
    expect(
      rewardForPvp({
        result: "WHITE_WIN",
        color: "w",
        plies: MIN_REWARDED_PLIES - 1,
      }),
    ).toEqual({ xp: 0, coins: 0 });
  });

  test("an abort pays nothing", () => {
    expect(
      rewardForPvp({ result: "ABORTED", color: "w", plies: LONG_ENOUGH }),
    ).toEqual({ xp: 0, coins: 0 });
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
    const after = statsAfter(before, "win", 1212);

    expect(after.wins).toBe(5);
    expect(after.currentWinStreak).toBe(5);
    expect(after.topWinStreak).toBe(5);
  });

  test("a loss breaks the streak but leaves the best one standing", () => {
    const after = statsAfter(before, "loss", 1188);

    expect(after.losses).toBe(2);
    expect(after.currentWinStreak).toBe(0);
    expect(after.topWinStreak).toBe(4);
  });

  // Ported from the streak rule in the original draft: a repetition should not
  // cost a player a streak they never lost.
  test("a draw neither extends nor breaks the streak", () => {
    const after = statsAfter(before, "draw", 1200);

    expect(after.draws).toBe(1);
    expect(after.currentWinStreak).toBe(4);
    expect(after.topWinStreak).toBe(4);
  });

  test("the rating handed in is the rating recorded", () => {
    expect(statsAfter(before, "win", 1234).rating).toBe(1234);
  });
});

describe("resultForTimeout", () => {
  test("a flag falling loses for the side whose clock ran out", () => {
    expect(resultForTimeout("w")).toBe("BLACK_WIN");
    expect(resultForTimeout("b")).toBe("WHITE_WIN");
  });
});

describe("clock helpers", () => {
  const clock = { whiteTimeMs: 30_000, blackTimeMs: 45_000 };

  test("timeOf reads the right side", () => {
    expect(timeOf(clock, "w")).toBe(30_000);
    expect(timeOf(clock, "b")).toBe(45_000);
  });

  test("hasFlagged is true once the elapsed time reaches the clock", () => {
    expect(hasFlagged(clock, "w", 29_999)).toBe(false);
    // Reaching exactly zero is a fallen flag, like a physical clock.
    expect(hasFlagged(clock, "w", 30_000)).toBe(true);
    expect(hasFlagged(clock, "w", 31_000)).toBe(true);
  });

  test("a move deducts the elapsed time and adds the increment", () => {
    // White thinks 10s on a 2s-increment clock: 30 - 10 + 2 = 22s left.
    const after = clockAfterMove({
      clock,
      mover: "w",
      elapsedMs: 10_000,
      incrementSeconds: 2,
    });

    expect(after).not.toBeNull();
    expect(after?.whiteTimeMs).toBe(22_000);
    // The side that did not move is untouched.
    expect(after?.blackTimeMs).toBe(45_000);
  });

  test("a move on a fallen flag returns null — it does not count", () => {
    const after = clockAfterMove({
      clock,
      mover: "w",
      elapsedMs: 30_001,
      incrementSeconds: 2,
    });

    expect(after).toBeNull();
  });

  test("increment can carry a clock above its start, as real clocks do", () => {
    const after = clockAfterMove({
      clock,
      mover: "b",
      elapsedMs: 1_000,
      incrementSeconds: 5,
    });

    // 45 - 1 + 5 = 49s.
    expect(after?.blackTimeMs).toBe(49_000);
  });
});
