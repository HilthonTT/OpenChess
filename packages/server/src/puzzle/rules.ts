import {
  DEFAULT_PUZZLE_RATING,
  puzzleRatingAfter,
  type Puzzle,
} from "@openchess/shared";

export type PuzzleReward = {
  xp: number;
  coins: number;
};

const NOTHING: PuzzleReward = { xp: 0, coins: 0 };

const BASE_SOLVE: PuzzleReward = { xp: 12, coins: 8 };

const MIN_MULTIPLIER = 0.25;
const MAX_MULTIPLIER = 2;

export function difficultyMultiplier(
  puzzleRating: number,
  solverRating: number,
): number {
  const raw = 1 + (puzzleRating - solverRating) / 400;
  return Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw));
}

export function puzzleReward(input: {
  solved: boolean;
  hintUsed: boolean;
  puzzleRating: number;
  solverRating: number;
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

export function puzzleStreakAfter(current: number, solved: boolean): number {
  return solved ? current + 1 : 0;
}

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

export { DEFAULT_PUZZLE_RATING };

export type PuzzleView = {
  id: string;
  fen: string;
  openingMove: string;
  rating: number;
  themes: string[];
  sourceUrl: string | null;
  solverMoves: number;
  attempted: boolean;
  daily: boolean;
};

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
    solverMoves: Math.ceil((row.moves.length - 1) / 2),
    attempted: options.attempted,
    daily: options.daily,
  };
}

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
