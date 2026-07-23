import type { Difficulty } from "@openchess/database";

import type { Outcome, StatsDelta } from "./rules";

/**
 * Achievement unlock rules, keyed by `Achievement.code`.
 *
 * The schema is explicit that `code` is the stable key and `name` is display
 * copy that will get reworded — so everything here keys off `code` and nothing
 * reads a name. A code with no rule never unlocks; a rule with no row in the
 * `Achievement` table unlocks nothing. Both are fine, and both let the copy and
 * the logic ship independently.
 */

export type UnlockContext = {
  /** The player's stats *after* this game has been counted. */
  stats: StatsDelta;
  outcome: Outcome;
  /** Null for a PvP game — the difficulty achievements are AI-only by nature. */
  difficulty: Difficulty | null;
  plies: number;
  /** True when the player won by delivering checkmate, rather than on a resign. */
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

  // Won by mate rather than by the bot running out of moves to make.
  CHECKMATE_ARTIST: (c) => c.outcome === "win" && c.byCheckmate,

  // A mate inside 20 plies is a scholar's-mate-shaped game.
  QUICK_MATE: (c) => c.outcome === "win" && c.byCheckmate && c.plies <= 20,

  // Grinding a draw out of the strongest bot is its own achievement.
  IRON_WALL: (c) => c.outcome === "draw" && c.difficulty === "HARD",
};

/** The codes whose rules `context` satisfies. */
export function satisfiedCodes(context: UnlockContext): string[] {
  return Object.entries(RULES)
    .filter(([, rule]) => rule(context))
    .map(([code]) => code);
}

/**
 * The daily check-in rules, kept beside the game ones so that every unlock
 * condition in the product is readable in one file — and so the seed's
 * invariant, that every code here has a row in the catalog, stays checkable by
 * looking in a single place.
 *
 * These take a streak day rather than an `UnlockContext`: a check-in has no
 * game, no outcome and no difficulty, and threading nulls through the game
 * shape to pretend otherwise would make both rule sets harder to read.
 */
const STREAK_RULES: Record<string, (day: number) => boolean> = {
  DAILY_STREAK_3: (day) => day >= 3,
  DAILY_STREAK_7: (day) => day >= 7,
  DAILY_STREAK_30: (day) => day >= 30,
};

/** The codes a check-in landing on streak day `day` satisfies. */
export function satisfiedStreakCodes(day: number): string[] {
  return Object.entries(STREAK_RULES)
    .filter(([, rule]) => rule(day))
    .map(([code]) => code);
}
