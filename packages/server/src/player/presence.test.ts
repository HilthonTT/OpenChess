import { describe, expect, test } from "bun:test";

import { isOnline, presenceOf } from "./presence";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms);

const MINUTE = 60_000;

describe("isOnline", () => {
  test("counts a player seen a moment ago", () => {
    expect(isOnline(ago(5_000), NOW)).toBe(true);
  });

  test("counts a player seen inside the window", () => {
    expect(isOnline(ago(4 * MINUTE), NOW)).toBe(true);
  });

  test("does not count one seen before it", () => {
    expect(isOnline(ago(6 * MINUTE), NOW)).toBe(false);
  });

  test("is wider than the write throttle", () => {
    expect(isOnline(ago(90_000), NOW)).toBe(true);
  });

  test("does not count a player never seen", () => {
    expect(isOnline(null, NOW)).toBe(false);
  });
});

describe("presenceOf", () => {
  test("reports a recent visitor as online", () => {
    expect(presenceOf(ago(MINUTE), false, NOW).state).toBe("online");
  });

  test("reports one in a game as playing", () => {
    expect(presenceOf(ago(MINUTE), true, NOW).state).toBe("playing");
  });

  test("does not report an absent player as playing, whatever their games say", () => {
    expect(presenceOf(ago(60 * MINUTE), true, NOW).state).toBe("offline");
  });

  test("reports a player never seen as offline", () => {
    expect(presenceOf(null, false, NOW)).toEqual({
      state: "offline",
      lastSeenAt: null,
    });
  });

  test("carries the timestamp through, whatever the state", () => {
    const seen = ago(MINUTE);

    expect(presenceOf(seen, false, NOW).lastSeenAt).toBe(seen.toISOString());
  });
});
