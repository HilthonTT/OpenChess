import type { Difficulty } from "@openchess/database";

import type { Outcome, StatsDelta } from "./rules";

export type UnlockContext = {
  stats: StatsDelta;
  outcome: Outcome;
  difficulty: Difficulty | null;
  plies: number;
  byCheckmate: boolean;
};

type Rule = (context: UnlockContext) => boolean;

const RULES: Record<string, Rule> = {
  FIRST_WIN: (c) => c.outcome === "win" && c.stats.wins === 1,
  TEN_WINS: (c) => c.stats.wins >= 10,
  HUNDRED_WINS: (c) => c.stats.wins >= 100,

  WIN_STREAK_3: (c) => c.stats.currentWinStreak >= 3,
  WIN_STREAK_5: (c) => c.stats.currentWinStreak >= 5,
  WIN_STREAK_10: (c) => c.stats.currentWinStreak >= 10,

  BEAT_EASY: (c) => c.outcome === "win" && c.difficulty === "EASY",
  BEAT_MEDIUM: (c) => c.outcome === "win" && c.difficulty === "MEDIUM",
  BEAT_HARD: (c) => c.outcome === "win" && c.difficulty === "HARD",

  CHECKMATE_ARTIST: (c) => c.outcome === "win" && c.byCheckmate,

  QUICK_MATE: (c) => c.outcome === "win" && c.byCheckmate && c.plies <= 20,

  IRON_WALL: (c) => c.outcome === "draw" && c.difficulty === "HARD",
};

export function satisfiedCodes(context: UnlockContext): string[] {
  return Object.entries(RULES)
    .filter(([, rule]) => rule(context))
    .map(([code]) => code);
}

const STREAK_RULES: Record<string, (day: number) => boolean> = {
  DAILY_STREAK_3: (day) => day >= 3,
  DAILY_STREAK_7: (day) => day >= 7,
  DAILY_STREAK_30: (day) => day >= 30,
};

export function satisfiedStreakCodes(day: number): string[] {
  return Object.entries(STREAK_RULES)
    .filter(([, rule]) => rule(day))
    .map(([code]) => code);
}

const RUSH_RULES: Record<string, (solved: number) => boolean> = {
  RUSH_FIRST: (solved) => solved >= 1,
  RUSH_10: (solved) => solved >= 10,
  RUSH_20: (solved) => solved >= 20,
  RUSH_30: (solved) => solved >= 30,
};

export function satisfiedRushCodes(solved: number): string[] {
  return Object.entries(RUSH_RULES)
    .filter(([, rule]) => rule(solved))
    .map(([code]) => code);
}

export type PuzzleUnlockContext = {
  solved: boolean;
  puzzlesSolved: number;
  streak: number;
  puzzleRating: number;
  daily: boolean;
};

const PUZZLE_RULES: Record<string, (context: PuzzleUnlockContext) => boolean> =
  {
    PUZZLE_FIRST: (c) => c.solved && c.puzzlesSolved === 1,
    PUZZLE_TEN: (c) => c.solved && c.puzzlesSolved >= 10,
    PUZZLE_HUNDRED: (c) => c.solved && c.puzzlesSolved >= 100,

    PUZZLE_STREAK_5: (c) => c.solved && c.streak >= 5,
    PUZZLE_STREAK_20: (c) => c.solved && c.streak >= 20,

    PUZZLE_HARD: (c) => c.solved && c.puzzleRating >= 1800,

    DAILY_PUZZLE: (c) => c.solved && c.daily,
  };

export function satisfiedPuzzleCodes(context: PuzzleUnlockContext): string[] {
  return Object.entries(PUZZLE_RULES)
    .filter(([, rule]) => rule(context))
    .map(([code]) => code);
}
