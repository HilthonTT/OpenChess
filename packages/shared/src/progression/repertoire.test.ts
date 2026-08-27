import { describe, expect, test } from "bun:test";

import {
  EASY_MS_PER_MOVE,
  MAX_INTERVAL_DAYS,
  MIN_EASE,
  NEW_LINE,
  gradeFor,
  nextDue,
  reviewLine,
  reviewXp,
  type ReviewState,
} from "./repertoire";

/** Review a fresh line `times` times at one grade. */
function drill(times: number, grade: "good" | "easy"): ReviewState {
  let state = NEW_LINE;
  for (let i = 0; i < times; i += 1) {
    state = reviewLine(state, grade);
  }
  return state;
}

describe("reviewLine", () => {
  test("starts a new line at the two fixed steps", () => {
    const first = reviewLine(NEW_LINE, "good");
    expect(first.intervalDays).toBe(1);

    const second = reviewLine(first, "good");
    expect(second.intervalDays).toBe(4);
  });

  test("multiplies by the ease from the third clean review on", () => {
    const second = drill(2, "good");
    const third = reviewLine(second, "good");

    expect(third.intervalDays).toBe(Math.round(4 * second.ease));
    expect(third.intervalDays).toBeGreaterThan(second.intervalDays);
  });

  test("stretches faster when the line is easy", () => {
    const steady = drill(5, "good");
    const quick = drill(5, "easy");

    expect(quick.ease).toBeGreaterThan(steady.ease);
    expect(quick.intervalDays).toBeGreaterThan(steady.intervalDays);
  });

  // A line you have just got wrong is one to play again while you can still see
  // why — the whole cost of being wrong in a drill is doing it once more.
  test("brings a failed line back the same day", () => {
    const known = drill(4, "good");
    const failed = reviewLine(known, "again");

    expect(failed.intervalDays).toBe(0);
    expect(failed.streak).toBe(0);
    expect(failed.lapses).toBe(1);
    expect(failed.ease).toBeLessThan(known.ease);
  });

  // The point of tracking the streak separately from the review count: a line
  // that lapses is relearned from the short steps rather than snapping back to
  // the month it had reached before it was forgotten.
  test("relearns a lapsed line from the bottom", () => {
    const known = drill(6, "good");
    expect(known.intervalDays).toBeGreaterThan(20);

    const relearning = reviewLine(reviewLine(known, "again"), "good");

    expect(relearning.intervalDays).toBe(1);
    expect(relearning.reviews).toBe(8);
    expect(relearning.lapses).toBe(1);
  });

  test("floors the ease rather than letting it run to nothing", () => {
    let state = NEW_LINE;
    for (let i = 0; i < 40; i += 1) {
      state = reviewLine(state, "again");
    }

    expect(state.ease).toBe(MIN_EASE);
    expect(state.lapses).toBe(40);
  });

  test("caps the interval at half a year", () => {
    let state = NEW_LINE;
    for (let i = 0; i < 30; i += 1) {
      state = reviewLine(state, "easy");
    }

    expect(state.intervalDays).toBe(MAX_INTERVAL_DAYS);
  });

  test("never schedules a clean review for today", () => {
    let state = NEW_LINE;
    for (let i = 0; i < 12; i += 1) {
      state = reviewLine(state, i % 3 === 0 ? "easy" : "good");
      expect(state.intervalDays).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("nextDue", () => {
  test("adds the interval to the moment of the review", () => {
    const at = new Date("2026-08-27T10:00:00.000Z");
    const due = nextDue({ ...NEW_LINE, intervalDays: 4 }, at);

    expect(due.toISOString()).toBe("2026-08-31T10:00:00.000Z");
  });

  test("a failed line is due immediately", () => {
    const at = new Date("2026-08-27T10:00:00.000Z");

    expect(nextDue({ ...NEW_LINE, intervalDays: 0 }, at).getTime()).toBe(
      at.getTime(),
    );
  });
});

describe("gradeFor", () => {
  // An opening line is a sequence, and half of one is not half as useful.
  test("fails the whole line for one wrong move, however long it was", () => {
    expect(gradeFor({ mistakes: 1, msSpent: 100, moves: 20 })).toBe("again");
  });

  test("is easy when it was clean and quick", () => {
    expect(
      gradeFor({ mistakes: 0, msSpent: 4 * EASY_MS_PER_MOVE, moves: 4 }),
    ).toBe("easy");
  });

  test("is good when it was clean and slow", () => {
    expect(
      gradeFor({ mistakes: 0, msSpent: 4 * EASY_MS_PER_MOVE + 1, moves: 4 }),
    ).toBe("good");
  });

  // The benefit of the doubt runs towards seeing the line again sooner.
  test("is good, never easy, when the client reported no timing", () => {
    expect(gradeFor({ mistakes: 0, msSpent: null, moves: 4 })).toBe("good");
    expect(gradeFor({ mistakes: 0, msSpent: 1, moves: 0 })).toBe("good");
  });
});

describe("reviewXp", () => {
  test("pays nothing for a line you got wrong", () => {
    expect(reviewXp({ grade: "again", moves: 20 })).toBe(0);
  });

  test("pays per move you had to find", () => {
    expect(reviewXp({ grade: "good", moves: 4 })).toBe(8);
  });

  // A long line must not be a better rate than a short one for the time it
  // takes, or the repertoire becomes a place to park one enormous line.
  test("caps what a long line is worth", () => {
    expect(reviewXp({ grade: "easy", moves: 30 })).toBe(30);
    expect(reviewXp({ grade: "easy", moves: 300 })).toBe(30);
  });

  test("pays something for even the shortest line", () => {
    expect(reviewXp({ grade: "good", moves: 1 })).toBe(2);
  });
});
