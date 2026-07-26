/**
 * A rating curve as one line of text.
 *
 * Eight block heights is all a terminal row affords, so the interesting thing is
 * what the bars are scaled *against*. Scaling to the series' own min and max —
 * rather than to zero, or to the whole Elo range — is what makes a fifteen-point
 * wobble legible at all: a chart anchored at zero would draw every rating a
 * player will ever hold as the same full-height bar.
 *
 * The cost of that choice is that height is only ever relative. A tall bar means
 * "high for this run of games", never "high". The screen prints the numbers
 * beside the line for the same reason.
 */

/** Shortest to tallest. Index 0 is the series minimum, 7 the maximum. */
const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

/**
 * Render `values` as block characters, scaled to their own range.
 *
 * A flat series — every value equal, including the single-point case — has no
 * range to scale against, and every bar comes out mid-height rather than at an
 * arbitrary end: division by a zero range would otherwise decide the whole
 * line's height on a rounding convention.
 */
export function sparkline(values: readonly number[]): string {
  if (values.length === 0) {
    return "";
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;

  if (range === 0) {
    return BLOCKS[Math.floor(BLOCKS.length / 2)]!.repeat(values.length);
  }

  return values
    .map((value) => {
      // Scaled into [0, 1] then onto the block index. `min` lands on index 0 and
      // `max` on the last one, so both ends of the range are actually drawn.
      const height = Math.round(((value - min) / range) * (BLOCKS.length - 1));
      return BLOCKS[height]!;
    })
    .join("");
}
