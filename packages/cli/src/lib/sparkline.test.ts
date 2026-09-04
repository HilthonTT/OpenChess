import { describe, expect, test } from "bun:test";

import { sparkline } from "./sparkline";

describe("sparkline", () => {
  test("one bar per value", () => {
    expect(sparkline([1, 2, 3, 4])).toHaveLength(4);
  });

  test("nothing to plot draws nothing", () => {
    expect(sparkline([])).toBe("");
  });

  test("the extremes land on the extreme blocks", () => {
    const line = sparkline([1200, 1250, 1300]);

    expect(line[0]).toBe("▁");
    expect(line[2]).toBe("█");
  });

  test("a rise reads as a rise, a fall as a fall", () => {
    expect(sparkline([1, 2, 3, 4, 5, 6, 7, 8])).toBe("▁▂▃▄▅▆▇█");
    expect(sparkline([8, 7, 6, 5, 4, 3, 2, 1])).toBe("█▇▆▅▄▃▂▁");
  });

  test("a flat series sits mid-height rather than at an arbitrary end", () => {
    expect(sparkline([1200, 1200, 1200])).toBe("▅▅▅");
    expect(sparkline([1200])).toBe("▅");
  });

  test("scaling is relative to the series, not to zero", () => {
    expect(sparkline([1200, 1207, 1215])).toBe("▁▄█");
  });

  test("negative values are just another range", () => {
    expect(sparkline([-20, -10, 0])).toBe("▁▅█");
  });
});
