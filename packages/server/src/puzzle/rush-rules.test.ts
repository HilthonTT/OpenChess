import { describe, expect, test } from "bun:test";
import type { PuzzleRushMode } from "@openchess/database";

import { RUSH_MISS_LIMIT, rushRatingTarget, rushReward } from "./rush-rules";

const MODES: PuzzleRushMode[] = ["THREE_MINUTE", "FIVE_MINUTE", "SURVIVAL"];

describe("the difficulty ramp", () => {
  test("starts somewhere a beginner can take", () => {
    expect(rushRatingTarget(0)).toBeLessThanOrEqual(700);
  });

  test("climbs with every solve", () => {
    for (let solved = 0; solved < 20; solved += 1) {
      expect(rushRatingTarget(solved + 1)).toBeGreaterThan(
        rushRatingTarget(solved),
      );
    }
  });

  test("levels off rather than running past the corpus", () => {
    const ceiling = rushRatingTarget(1000);

    expect(ceiling).toBe(rushRatingTarget(500));
    expect(ceiling).toBeLessThanOrEqual(2600);
  });

  test("a negative score cannot drag it below the floor", () => {
    // Not reachable through the service, but the clamp is what makes that a
    // fact about this function rather than about its caller.
    expect(rushRatingTarget(-5)).toBe(rushRatingTarget(0));
  });
});

describe("what a run pays", () => {
  test("nothing at all for a run that solved nothing", () => {
    for (const mode of MODES) {
      expect(rushReward(0, mode), mode).toEqual({ xp: 0, coins: 0 });
    }
  });

  test("and nothing for a score that could not have happened", () => {
    expect(rushReward(-1, "SURVIVAL")).toEqual({ xp: 0, coins: 0 });
  });

  test("more for a better run, at every mode", () => {
    for (const mode of MODES) {
      for (let solved = 1; solved < 40; solved += 1) {
        const before = rushReward(solved, mode);
        const after = rushReward(solved + 1, mode);

        expect(after.xp, `${mode} ${solved}`).toBeGreaterThan(before.xp);
        expect(after.coins, `${mode} ${solved}`).toBeGreaterThan(before.coins);
      }
    }
  });

  test("with a jump at each milestone", () => {
    for (const at of [10, 20, 30]) {
      const before = rushReward(at - 1, "THREE_MINUTE");
      const at_ = rushReward(at, "THREE_MINUTE");
      const step = rushReward(at + 1, "THREE_MINUTE").xp - at_.xp;

      expect(at_.xp - before.xp, `milestone ${at}`).toBeGreaterThan(step);
    }
  });

  test("survival pays less per solve than the timed modes", () => {
    // With no clock on it, the same rate would make survival the only mode
    // anyone played.
    expect(rushReward(10, "SURVIVAL").xp).toBeLessThan(
      rushReward(10, "THREE_MINUTE").xp,
    );
    expect(rushReward(10, "SURVIVAL").coins).toBeLessThan(
      rushReward(10, "THREE_MINUTE").coins,
    );
  });

  test("a strong run is worth less than the rated queue would pay for it", () => {
    // A rush serves puzzles you may have solved before and moves no rating, so
    // it has to stay under the ladder or it would simply replace it. The rated
    // queue pays 8 coins for a solve at your own rating; twenty of those is
    // 160, and a twenty-run is well under that per puzzle.
    const twenty = rushReward(20, "THREE_MINUTE");

    expect(twenty.coins / 20).toBeLessThan(8);
  });
});

describe("the miss limit", () => {
  test("is three, which is what the UI counts down from", () => {
    expect(RUSH_MISS_LIMIT).toBe(3);
  });
});
