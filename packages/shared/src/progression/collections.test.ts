import { describe, expect, test } from "bun:test";

import {
  collectionThemeLabel,
  collectionsAreTrainable,
  findPuzzleCollection,
  isPuzzleCollectionId,
  PUZZLE_COLLECTIONS,
} from "./collections";
import { isTrainablePuzzleTheme } from "../chess/puzzle-themes";

describe("the collection catalog", () => {
  // A claim row points at an id. Two collections sharing one would pay the
  // wrong player for the wrong work, silently.
  test("gives every collection its own id", () => {
    const ids = PUZZLE_COLLECTIONS.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  // A collection on "crushing" or "middlegame" would be asking for a grind at
  // a tag that describes a puzzle rather than naming a skill — and the trainer
  // would not even offer it as a filter, so the player could not train it
  // deliberately if they wanted to.
  test("trains only themes the trainer offers", () => {
    expect(collectionsAreTrainable()).toBe(true);

    for (const entry of PUZZLE_COLLECTIONS) {
      expect(isTrainablePuzzleTheme(entry.theme)).toBe(true);
    }
  });

  test("asks for a real number of puzzles and pays for them", () => {
    for (const entry of PUZZLE_COLLECTIONS) {
      expect(entry.target).toBeGreaterThan(0);
      expect(entry.xpReward).toBeGreaterThan(0);
      expect(entry.coinReward).toBeGreaterThan(0);
      expect(entry.name.trim().length).toBeGreaterThan(0);
      expect(entry.description.trim().length).toBeGreaterThan(0);
    }
  });

  // The list opens on something a new player can finish rather than on the one
  // that takes a month.
  test("offers them easiest first", () => {
    const targets = PUZZLE_COLLECTIONS.map((entry) => entry.target);

    expect([...targets].sort((a, b) => a - b)).toEqual(targets);
  });

  // Scaled off the target, so adding a collection cannot accidentally be worth
  // ten times its neighbour.
  test("pays in proportion to what it asks", () => {
    for (const entry of PUZZLE_COLLECTIONS) {
      expect(entry.xpReward / entry.target).toBe(6);
      expect(entry.coinReward / entry.target).toBe(4);
    }
  });
});

describe("findPuzzleCollection", () => {
  test("finds one by id", () => {
    expect(findPuzzleCollection("pins-20")?.theme).toBe("pin");
  });

  // A claim written before a collection was retired still has to be readable.
  test("answers null for an id the catalog no longer has", () => {
    expect(findPuzzleCollection("collection-we-retired")).toBeNull();
    expect(isPuzzleCollectionId("collection-we-retired")).toBe(false);
  });
});

describe("collectionThemeLabel", () => {
  // Borrowed from the theme catalog rather than written out twice, so a theme
  // renamed there cannot leave a collection disagreeing with its own filter.
  test("names the theme the way the trainer does", () => {
    const pins = findPuzzleCollection("pins-20")!;

    expect(collectionThemeLabel(pins)).toBe("Pin");
  });
});
