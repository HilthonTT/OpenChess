import { describe, expect, test } from "bun:test";

import { isoWeekKey } from "./period";

describe("isoWeekKey", () => {
  test("names the ISO week a date falls in", () => {
    expect(isoWeekKey(new Date("2026-07-27T09:00:00.000Z"))).toBe("2026-W31");
  });

  test("pads single-digit weeks, so keys sort as strings", () => {
    expect(isoWeekKey(new Date("2026-03-02T00:00:00.000Z"))).toBe("2026-W10");
    expect(isoWeekKey(new Date("2026-02-02T00:00:00.000Z"))).toBe("2026-W06");
  });

  test("is the same for every moment of one Monday-to-Sunday week", () => {
    const monday = isoWeekKey(new Date("2026-07-27T07:00:00.000Z"));
    const sunday = isoWeekKey(new Date("2026-08-02T23:59:59.000Z"));

    expect(sunday).toBe(monday);
  });

  test("rolls over on Monday, so the next stipend gets its own key", () => {
    const thisWeek = isoWeekKey(new Date("2026-08-02T23:59:59.000Z"));
    const nextWeek = isoWeekKey(new Date("2026-08-03T00:00:00.000Z"));

    expect(nextWeek).not.toBe(thisWeek);
    expect(nextWeek).toBe("2026-W32");
  });

  test("belongs to the year holding the week's Thursday", () => {
    expect(isoWeekKey(new Date("2027-01-01T00:00:00.000Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T00:00:00.000Z"))).toBe("2027-W01");

    expect(isoWeekKey(new Date("2025-12-29T00:00:00.000Z"))).toBe("2026-W01");
  });

  test("counts week 53 in a long ISO year", () => {
    expect(isoWeekKey(new Date("2026-12-28T00:00:00.000Z"))).toBe("2026-W53");
  });
});
