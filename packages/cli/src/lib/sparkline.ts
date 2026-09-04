const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

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
      const height = Math.round(((value - min) / range) * (BLOCKS.length - 1));
      return BLOCKS[height]!;
    })
    .join("");
}
