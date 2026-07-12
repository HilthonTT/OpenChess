import type { Difficulty, GameResult } from "@openchess/database";
import {
  isDraw,
  levelFor,
  type Color,
  type Difficulty as EngineDifficulty,
  type GameStatus,
} from "@openchess/shared";

/**
 * The economy, kept pure.
 *
 * Nothing here touches the database or the engine's mutable state, which is the
 * point: these are the rules that decide what a game is *worth*, and they are
 * the part most worth having tests for. The service layer next door does the IO.
 */

/** The DB enum is SCREAMING_CASE; the engine's is lowercase. Bridge them once. */
const ENGINE_DIFFICULTY: Record<Difficulty, EngineDifficulty> = {
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
};

export function toEngineDifficulty(difficulty: Difficulty): EngineDifficulty {
  return ENGINE_DIFFICULTY[difficulty];
}

export type Outcome = "win" | "loss" | "draw";

export type Reward = {
  xp: number;
  coins: number;
};

/**
 * The bot's notional Elo, by difficulty. Only used to move the player's rating —
 * see `AI_GAMES_AFFECT_RATING`.
 */
export const BOT_RATING: Record<Difficulty, number> = {
  EASY: 800,
  MEDIUM: 1200,
  HARD: 1600,
};

/**
 * Whether beating the bot moves `UserStats.rating`.
 *
 * A judgement call, and the one most worth revisiting. Rating a human against a
 * bot of fixed strength is unusual — most systems keep rating strictly PvP. But
 * PvP does not exist yet, and the schema indexes `rating` for a leaderboard, so
 * leaving it switched off would ship a leaderboard on which nobody ever moves.
 * Set this to `false` the day PvP lands and rating becomes meaningful on its own.
 */
export const AI_GAMES_AFFECT_RATING = true;

/** Standard Elo development coefficient. 24 is a middling, unremarkable choice. */
const K_FACTOR = 24;

/**
 * Games shorter than this pay nothing.
 *
 * An AI game is free to start and free to resign, so any payout on a short loss
 * is a coin printer: start, resign, repeat, bank the difference. The floor makes
 * the cheapest farm — resign at move one — worth exactly zero.
 */
export const MIN_REWARDED_PLIES = 10;

const BASE_REWARD: Record<Outcome, Reward> = {
  win: { xp: 30, coins: 20 },
  draw: { xp: 12, coins: 8 },
  // A loss pays a consolation of XP but no coins, for the same reason as above:
  // XP only ever unlocks content, while coins buy it.
  loss: { xp: 5, coins: 0 },
};

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  EASY: 1,
  MEDIUM: 1.5,
  HARD: 2,
};

const NOTHING: Reward = { xp: 0, coins: 0 };

/**
 * The result of a finished game, from the engine's terminal status.
 *
 * `turn` is the side *to move* in the terminal position — which, on a checkmate,
 * is the side that has been mated. Returns null while the game is still live.
 */
export function resultFor(status: GameStatus, turn: Color): GameResult | null {
  if (status === "checkmate") {
    return turn === "w" ? "BLACK_WIN" : "WHITE_WIN";
  }

  if (isDraw(status)) {
    return "DRAW";
  }

  return null;
}

/** The result of `player` resigning: the other side wins. */
export function resultForResignation(player: Color): GameResult {
  return player === "w" ? "BLACK_WIN" : "WHITE_WIN";
}

/** How `result` went for the player of `color`. Null for a game that was aborted. */
export function outcomeFor(
  result: GameResult,
  color: Color,
): Outcome | null {
  if (result === "ABORTED") {
    return null;
  }

  if (result === "DRAW") {
    return "draw";
  }

  const winner: Color = result === "WHITE_WIN" ? "w" : "b";
  return winner === color ? "win" : "loss";
}

/** Elo's expected score for a player rated `rating` against `opponent`. */
export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

const SCORE: Record<Outcome, number> = { win: 1, draw: 0.5, loss: 0 };

/**
 * The player's new rating after `outcome` against a bot of `difficulty`.
 * Returns `rating` untouched when AI games are not rated.
 */
export function ratingAfter(
  rating: number,
  outcome: Outcome,
  difficulty: Difficulty,
): number {
  if (!AI_GAMES_AFFECT_RATING) {
    return rating;
  }

  const expected = expectedScore(rating, BOT_RATING[difficulty]);
  const delta = K_FACTOR * (SCORE[outcome] - expected);

  // Round away from zero so a near-certain win still nudges the rating up by a
  // point rather than truncating to no change at all.
  const rounded = delta >= 0 ? Math.ceil(delta) : Math.floor(delta);

  return Math.max(100, rating + rounded);
}

/** What a finished game pays its player. */
export function rewardFor(input: {
  result: GameResult;
  color: Color;
  difficulty: Difficulty;
  plies: number;
}): Reward {
  const outcome = outcomeFor(input.result, input.color);

  // An abort is not a game; a two-move game is not one either.
  if (outcome === null || input.plies < MIN_REWARDED_PLIES) {
    return NOTHING;
  }

  const base = BASE_REWARD[outcome];
  const multiplier = DIFFICULTY_MULTIPLIER[input.difficulty];

  return {
    xp: Math.round(base.xp * multiplier),
    coins: Math.round(base.coins * multiplier),
  };
}

export type StatsDelta = {
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  topWinStreak: number;
  rating: number;
};

/** The player's stats row after a game, given the row before it. */
export function statsAfter(
  before: {
    wins: number;
    losses: number;
    draws: number;
    currentWinStreak: number;
    topWinStreak: number;
    rating: number;
  },
  outcome: Outcome,
  difficulty: Difficulty,
): StatsDelta {
  // A win extends the streak and a loss breaks it, but a draw does neither:
  // losing a ten-win streak to a threefold repetition would read as a bug to
  // the player, not as a rule.
  const currentWinStreak =
    outcome === "win"
      ? before.currentWinStreak + 1
      : outcome === "loss"
        ? 0
        : before.currentWinStreak;

  return {
    wins: before.wins + (outcome === "win" ? 1 : 0),
    losses: before.losses + (outcome === "loss" ? 1 : 0),
    draws: before.draws + (outcome === "draw" ? 1 : 0),
    currentWinStreak,
    topWinStreak: Math.max(before.topWinStreak, currentWinStreak),
    rating: ratingAfter(before.rating, outcome, difficulty),
  };
}

/** Re-export so the reward pipeline and the client agree on one curve. */
export { levelFor };
