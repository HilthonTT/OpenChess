import { describe, expect, test } from "bun:test";
import {
  advanceStreak,
  previousDay,
  streakIsAlive,
  streakReward,
  STREAK_REWARD_CAP_DAY,
  utcDay,
  type Streak,
} from "./streak";

const NEVER: Streak = { current: 0, best: 0, lastDay: null };

describe("utcDay", () => {
  test("names the UTC calendar day", () => {
    expect(utcDay(new Date("2026-07-23T14:30:00.000Z"))).toBe("2026-07-23");
  });

  test("a minute before midnight is still the same day", () => {
    expect(utcDay(new Date("2026-07-23T23:59:59.999Z"))).toBe("2026-07-23");
    expect(utcDay(new Date("2026-07-24T00:00:00.000Z"))).toBe("2026-07-24");
  });
});

describe("previousDay", () => {
  test("steps back one day", () => {
    expect(previousDay("2026-07-23")).toBe("2026-07-22");
  });

  test("crosses a month boundary", () => {
    expect(previousDay("2026-08-01")).toBe("2026-07-31");
  });

  test("crosses a year boundary", () => {
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  test("handles a leap day", () => {
    expect(previousDay("2028-03-01")).toBe("2028-02-29");
  });
});

describe("advanceStreak", () => {
  test("a first ever check-in starts at day one", () => {
    const { streak, claimed } = advanceStreak(NEVER, "2026-07-23");

    expect(claimed).toBe(true);
    expect(streak).toEqual({
      current: 1,
      best: 1,
      lastDay: "2026-07-23",
    });
  });

  test("checking in on consecutive days extends the run", () => {
    const before: Streak = { current: 4, best: 9, lastDay: "2026-07-22" };
    const { streak, claimed } = advanceStreak(before, "2026-07-23");

    expect(claimed).toBe(true);
    expect(streak.current).toBe(5);
    // The run is still short of the record, which is left alone.
    expect(streak.best).toBe(9);
  });

  test("passing the record raises it", () => {
    const before: Streak = { current: 9, best: 9, lastDay: "2026-07-22" };
    expect(advanceStreak(before, "2026-07-23").streak.best).toBe(10);
  });

  test("a missed day restarts at one without touching the record", () => {
    const before: Streak = { current: 12, best: 12, lastDay: "2026-07-20" };
    const { streak, claimed } = advanceStreak(before, "2026-07-23");

    expect(claimed).toBe(true);
    expect(streak.current).toBe(1);
    expect(streak.best).toBe(12);
  });

  test("a second check-in the same day claims nothing", () => {
    const before: Streak = { current: 3, best: 7, lastDay: "2026-07-23" };
    const { streak, claimed } = advanceStreak(before, "2026-07-23");

    expect(claimed).toBe(false);
    expect(streak).toEqual(before);
  });

  test("a lastDay in the future restarts rather than extending", () => {
    // Only reachable if a clock moved backwards. Restarting is the reading that
    // cannot be farmed; extending would pay for every backwards step.
    const before: Streak = { current: 5, best: 5, lastDay: "2026-07-30" };
    const { streak } = advanceStreak(before, "2026-07-23");

    expect(streak.current).toBe(1);
    expect(streak.best).toBe(5);
  });

  test("a run across a month boundary is unbroken", () => {
    const before: Streak = { current: 2, best: 2, lastDay: "2026-07-31" };
    expect(advanceStreak(before, "2026-08-01").streak.current).toBe(3);
  });
});

describe("streakReward", () => {
  test("day one pays the base", () => {
    expect(streakReward(1)).toEqual({ xp: 15, coins: 5 });
  });

  test("each further day pays more", () => {
    expect(streakReward(2).xp).toBeGreaterThan(streakReward(1).xp);
    expect(streakReward(2).coins).toBeGreaterThan(streakReward(1).coins);
  });

  test("stops growing at the cap", () => {
    const capped = streakReward(STREAK_REWARD_CAP_DAY);

    expect(streakReward(STREAK_REWARD_CAP_DAY + 1)).toEqual(capped);
    expect(streakReward(400)).toEqual(capped);
  });

  test("the capped payout stays under a won online game", () => {
    // PvP pays 70 xp / 45 coins for a win. Showing up must not out-earn that.
    const capped = streakReward(STREAK_REWARD_CAP_DAY);

    expect(capped.xp).toBeLessThan(70);
    expect(capped.coins).toBeLessThan(45);
  });

  test("a nonsense day is clamped rather than paying nothing", () => {
    expect(streakReward(0)).toEqual(streakReward(1));
    expect(streakReward(-3)).toEqual(streakReward(1));
  });
});

describe("streakIsAlive", () => {
  test("today and yesterday are both still alive", () => {
    expect(streakIsAlive("2026-07-23", "2026-07-23")).toBe(true);
    expect(streakIsAlive("2026-07-22", "2026-07-23")).toBe(true);
  });

  test("two days ago is broken, as is never having checked in", () => {
    expect(streakIsAlive("2026-07-21", "2026-07-23")).toBe(false);
    expect(streakIsAlive(null, "2026-07-23")).toBe(false);
  });
});
