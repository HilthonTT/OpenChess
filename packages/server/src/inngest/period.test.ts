import { describe, expect, test } from "bun:test";

import { isoWeekKey } from "./period";

describe("isoWeekKey", () => {
  test("names the ISO week a date falls in", () => {
    // 2026-07-27 is a Monday, in ISO week 31.
    expect(isoWeekKey(new Date("2026-07-27T09:00:00.000Z"))).toBe("2026-W31");
  });

  test("pads single-digit weeks, so keys sort as strings", () => {
    expect(isoWeekKey(new Date("2026-03-02T00:00:00.000Z"))).toBe("2026-W10");
    expect(isoWeekKey(new Date("2026-02-02T00:00:00.000Z"))).toBe("2026-W06");
  });

  test("is the same for every moment of one Monday-to-Sunday week", () => {
    // The stipend fires Monday morning; a retry hours later, or a duplicate
    // delivery on the Sunday, must name the week that was already paid.
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
    // 2027-01-01 is a Friday, so its week's Thursday is 2026-12-31: ISO calls
    // it 2026-W53. Naming it 2027-W01 would collide with the following week.
    expect(isoWeekKey(new Date("2027-01-01T00:00:00.000Z"))).toBe("2026-W53");
    expect(isoWeekKey(new Date("2027-01-04T00:00:00.000Z"))).toBe("2027-W01");

    // The mirror case: 2025-12-29 is a Monday whose Thursday is 2026-01-01.
    expect(isoWeekKey(new Date("2025-12-29T00:00:00.000Z"))).toBe("2026-W01");
  });

  test("counts week 53 in a long ISO year", () => {
    // 2026 starts on a Thursday, which is what gives it 53 ISO weeks.
    expect(isoWeekKey(new Date("2026-12-28T00:00:00.000Z"))).toBe("2026-W53");
  });
});
