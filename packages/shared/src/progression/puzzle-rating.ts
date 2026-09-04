export const DEFAULT_PUZZLE_RATING = 1000;

const MINIMUM_RATING = 100;

const K_FACTOR = 32;

export function expectedSolveRate(
  rating: number,
  puzzleRating: number,
): number {
  return 1 / (1 + 10 ** ((puzzleRating - rating) / 400));
}

export function puzzleRatingAfter(input: {
  rating: number;
  puzzleRating: number;
  solved: boolean;
  hintUsed?: boolean;
}): number {
  const score = input.solved ? (input.hintUsed ? 0.5 : 1) : 0;
  const delta =
    K_FACTOR * (score - expectedSolveRate(input.rating, input.puzzleRating));

  const rounded = delta >= 0 ? Math.ceil(delta) : Math.floor(delta);

  return Math.max(MINIMUM_RATING, input.rating + rounded);
}

export function puzzleRatingBand(
  rating: number,
  attempt = 0,
): { min: number; max: number } {
  const width = 100 + attempt * 150;
  return { min: rating - width, max: rating + width };
}
