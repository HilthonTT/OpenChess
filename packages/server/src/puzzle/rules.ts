import {
  DEFAULT_PUZZLE_RATING,
  puzzleRatingAfter,
  type Puzzle,
} from "@openchess/shared";

/**
 * What a puzzle is worth, kept pure beside the service that pays it out — the
 * same split `game/rules.ts` keeps for games.
 */

export type PuzzleReward = {
  xp: number;
  coins: number;
};

const NOTHING: PuzzleReward = { xp: 0, coins: 0 };

/**
 * A solve pays this much at a puzzle rated exactly the solver's own. The base
 * is deliberately under a won AI game: a puzzle is one move, and it can be
 * attempted far faster than a game can be played.
 */
const BASE_SOLVE: PuzzleReward = { xp: 12, coins: 8 };

/**
 * How far the payout scales with a puzzle's difficulty relative to the solver.
 * A puzzle 400 points above them pays double; one 400 below pays nothing extra
 * on top of the floor. Bounded at both ends so neither a sandbagged rating nor
 * a lucky guess at a 2500 puzzle turns into a coin printer.
 */
const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 2;

export function difficultyMultiplier(
  puzzleRating: number,
  solverRating: number,
): number {
  const raw = 1 + (puzzleRating - solverRating) / 400;
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw));
}

/**
 * What one attempt pays.
 *
 * A failure pays nothing at all — unlike a lost game, which pays a consolation
 * of XP. The difference is that a puzzle can be failed deliberately in one
 * keystroke, so any payout on a failure is a faucet with no cost attached.
 *
 * A hinted solve pays half, matching how the rating treats it.
 */
export function puzzleReward(input: {
  solved: boolean;
  hintUsed: boolean;
  puzzleRating: number;
  solverRating: number;
  /** False when the puzzle has already been attempted for credit. */
  scored: boolean;
}): PuzzleReward {
  if (!input.solved || !input.scored) {
    return NOTHING;
  }

  const multiplier =
    difficultyMultiplier(input.puzzleRating, input.solverRating) *
    (input.hintUsed ? 0.5 : 1);

  return {
    xp: Math.max(1, Math.round(BASE_SOLVE.xp * multiplier)),
    coins: Math.max(1, Math.round(BASE_SOLVE.coins * multiplier)),
  };
}

/** The puzzle streak after an attempt: a solve extends it, anything else ends it. */
export function puzzleStreakAfter(current: number, solved: boolean): number {
  return solved ? current + 1 : 0;
}

/**
 * The solver's rating after an attempt. An unscored replay — a puzzle already
 * attempted for credit — leaves the rating exactly where it was, so grinding a
 * known puzzle can neither raise nor lower it.
 */
export function ratingAfterAttempt(input: {
  rating: number;
  puzzleRating: number;
  solved: boolean;
  hintUsed: boolean;
  scored: boolean;
}): number {
  if (!input.scored) {
    return input.rating;
  }

  return puzzleRatingAfter({
    rating: input.rating,
    puzzleRating: input.puzzleRating,
    solved: input.solved,
    hintUsed: input.hintUsed,
  });
}

/** Re-exported so the service and the client agree on the starting rating. */
export { DEFAULT_PUZZLE_RATING };

/** The shape the API hands a client: the puzzle, minus its answer. */
export type PuzzleView = {
  id: string;
  fen: string;
  /**
   * The opening move only. The rest of the line is the answer, and a client
   * that had it could not be asked to find it.
   */
  openingMove: string;
  rating: number;
  themes: string[];
  sourceUrl: string | null;
  /** How many solver moves the line asks for. */
  solverMoves: number;
  /** True when this puzzle has already been attempted for credit. */
  attempted: boolean;
  /** Whether this is today's puzzle. */
  daily: boolean;
};

/** Strip a stored puzzle down to what a solver may see. */
export function toPuzzleView(
  row: {
    id: string;
    fen: string;
    moves: string[];
    rating: number;
    themes: string[];
    sourceUrl: string | null;
    dailyOn: Date | null;
  },
  options: { attempted: boolean; daily: boolean },
): PuzzleView {
  return {
    id: row.id,
    fen: row.fen,
    openingMove: row.moves[0] ?? "",
    rating: row.rating,
    themes: row.themes,
    sourceUrl: row.sourceUrl,
    // The line is [blunder, solve, reply, solve, …], so the solver has half of
    // what is left after the opening move, rounded up.
    solverMoves: Math.ceil((row.moves.length - 1) / 2),
    attempted: options.attempted,
    daily: options.daily,
  };
}

/** The stored row, as the solve check needs it. */
export function toEnginePuzzle(row: {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
}): Puzzle {
  return {
    id: row.id,
    fen: row.fen,
    moves: row.moves,
    rating: row.rating,
    themes: row.themes,
  };
}
