/**
 * Puzzle rating.
 *
 * The same Elo arithmetic games use, with the puzzle standing in for the
 * opponent: solving one is a win against its rating, failing it is a loss.
 * Kept here rather than beside the game rules because the client shows a
 * player what a puzzle is worth *before* they attempt it, and that preview has
 * to agree with what the server later writes.
 *
 * The puzzle's own rating never moves. A player-versus-catalog system has no
 * reason to let one strong solver make a puzzle harder for everyone else, and
 * a fixed rating is what makes an imported corpus mean the same thing here as
 * it did where it was calibrated.
 */

/** Starting puzzle rating for a player who has never solved one. */
export const DEFAULT_PUZZLE_RATING = 1000;

/** A rating floor, matching the game ladder's. */
const MINIMUM_RATING = 100;

/**
 * Larger than the game K-factor of 24: a puzzle is one move rather than one
 * game, so a session produces far more results, and a slow coefficient would
 * leave a new player grinding through dozens of puzzles before the catalog
 * started handing them the right difficulty.
 */
const K_FACTOR = 32;

/** Elo's expected score for `rating` against a puzzle rated `puzzleRating`. */
export function expectedSolveRate(
  rating: number,
  puzzleRating: number,
): number {
  return 1 / (1 + 10 ** ((puzzleRating - rating) / 400));
}

/**
 * The solver's new rating after an attempt.
 *
 * A solve that needed a hint scores half — it is neither the clean solve the
 * full point would claim nor the failure a zero would record.
 */
export function puzzleRatingAfter(input: {
  rating: number;
  puzzleRating: number;
  solved: boolean;
  hintUsed?: boolean;
}): number {
  const score = input.solved ? (input.hintUsed ? 0.5 : 1) : 0;
  const delta =
    K_FACTOR * (score - expectedSolveRate(input.rating, input.puzzleRating));

  // Round away from zero, as the game ladder does, so an expected result still
  // moves the number by a point instead of truncating to nothing.
  const rounded = delta >= 0 ? Math.ceil(delta) : Math.floor(delta);

  return Math.max(MINIMUM_RATING, input.rating + rounded);
}

/**
 * The band a player should be served puzzles from: centred on their rating,
 * widening as they go without a solve so the catalog cannot strand someone on
 * a rating no puzzle sits near.
 */
export function puzzleRatingBand(
  rating: number,
  attempt = 0,
): { min: number; max: number } {
  const width = 100 + attempt * 150;
  return { min: rating - width, max: rating + width };
}
