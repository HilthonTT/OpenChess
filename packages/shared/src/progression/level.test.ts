import { describe, expect, test } from "bun:test";

import { levelFor, levelProgress, xpForLevel } from "./level";

describe("levelFor", () => {
  test("a new player is level 1", () => {
    expect(levelFor(0)).toBe(1);
  });

  test("never drops below 1, even on nonsense input", () => {
    expect(levelFor(-500)).toBe(1);
  });

  test("rises monotonically with experience", () => {
    let previous = levelFor(0);

    for (let xp = 0; xp < 20_000; xp += 137) {
      const level = levelFor(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });
});

describe("xpForLevel", () => {
  test("is the inverse of levelFor at every boundary", () => {
    for (let level = 1; level <= 50; level++) {
      const floor = xpForLevel(level);

      // The XP that begins a level is in that level...
      expect(levelFor(floor)).toBe(level);
      // ...and one XP short of it is still in the one below.
      if (level > 1) {
        expect(levelFor(floor - 1)).toBe(level - 1);
      }
    }
  });

  test("each level costs more than the last", () => {
    for (let level = 2; level < 20; level++) {
      const thisBand = xpForLevel(level + 1) - xpForLevel(level);
      const lastBand = xpForLevel(level) - xpForLevel(level - 1);

      expect(thisBand).toBeGreaterThan(lastBand);
    }
  });
});

describe("levelProgress", () => {
  test("a fresh player is at the very start of level 1", () => {
    const progress = levelProgress(0);

    expect(progress.level).toBe(1);
    expect(progress.xpIntoLevel).toBe(0);
    expect(progress.fraction).toBe(0);
  });

  test("the fraction stays inside the bar", () => {
    for (let xp = 0; xp < 10_000; xp += 61) {
      const { fraction } = levelProgress(xp);

      expect(fraction).toBeGreaterThanOrEqual(0);
      expect(fraction).toBeLessThan(1);
    }
  });

  test("xpIntoLevel and xpToNextLevel account for the whole band", () => {
    for (let xp = 0; xp < 5_000; xp += 43) {
      const p = levelProgress(xp);

      expect(p.xpIntoLevel + p.xpToNextLevel).toBe(p.levelSpan);
      expect(p.xpToNextLevel).toBeGreaterThan(0);
    }
  });
});
