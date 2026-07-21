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
 * Switched off the day online 1v1 landed, exactly as the original note here
 * promised: rating is now strictly PvP, the way most systems keep it. The bot
 * ratings above survive only as the notional strength labels they always were.
 */
export const AI_GAMES_AFFECT_RATING = false;

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

/**
 * The result of `player` running out of time: the other side wins, exactly as a
 * resignation would settle. A stricter engine would call it a draw when the
 * winner has no mating material left; OpenChess does not model that yet, so a
 * flag is always a loss for whoever's clock fell.
 */
export function resultForTimeout(player: Color): GameResult {
  return resultForResignation(player);
}

/** Remaining time on each side's clock, in milliseconds. */
export type ClockState = {
  whiteTimeMs: number;
  blackTimeMs: number;
};

/** The stored time on `color`'s clock. */
export function timeOf(clock: ClockState, color: Color): number {
  return color === "w" ? clock.whiteTimeMs : clock.blackTimeMs;
}

/**
 * Whether `color` has run out of time, given how long its clock has been
 * running since it was last committed. The `<= 0` boundary is a flag: reaching
 * exactly zero is out of time, matching how a physical clock's flag falls.
 */
export function hasFlagged(
  clock: ClockState,
  color: Color,
  elapsedMs: number,
): boolean {
  return timeOf(clock, color) - elapsedMs <= 0;
}

/**
 * The clock after `mover` completes a move that took `elapsedMs`: their time
 * drops by the elapsed and gains the increment, the other side untouched.
 * Returns null when the mover had already flagged — a move played on a fallen
 * flag does not count, it ends the game.
 */
export function clockAfterMove(input: {
  clock: ClockState;
  mover: Color;
  elapsedMs: number;
  incrementSeconds: number;
}): ClockState | null {
  const before = timeOf(input.clock, input.mover);
  const left = before - input.elapsedMs;

  if (left <= 0) {
    return null;
  }

  const after = left + input.incrementSeconds * 1000;

  return input.mover === "w"
    ? { whiteTimeMs: after, blackTimeMs: input.clock.blackTimeMs }
    : { whiteTimeMs: input.clock.whiteTimeMs, blackTimeMs: after };
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

/** The player's new rating after `outcome` against an opponent rated `opponent`. */
export function ratingAgainst(
  rating: number,
  opponent: number,
  outcome: Outcome,
): number {
  const expected = expectedScore(rating, opponent);
  const delta = K_FACTOR * (SCORE[outcome] - expected);

  // Round away from zero so a near-certain win still nudges the rating up by a
  // point rather than truncating to no change at all.
  const rounded = delta >= 0 ? Math.ceil(delta) : Math.floor(delta);

  return Math.max(100, rating + rounded);
}

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

  return ratingAgainst(rating, BOT_RATING[difficulty], outcome);
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

/**
 * PvP pays a flat rate a notch above a hard bot: a human opponent is the
 * hardest difficulty there is, and there is no slider to scale by.
 *
 * Coins are for wins only. A draw that paid coins would be a faucet: two
 * colluding accounts shuffling knights to a repetition past the ply floor
 * would bank coins on *both* sides forever, with their ratings pinned equal —
 * a draw between equals moves Elo by exactly zero. Win-trading past the floor
 * still pays one side per game; that residual risk is accepted (it stamps a
 * loss on someone's record every game and needs no more counterweight than
 * the AI table's), not pretended away.
 */
const PVP_REWARD: Record<Outcome, Reward> = {
  win: { xp: 70, coins: 45 },
  draw: { xp: 25, coins: 0 },
  // XP only, no coins — the same resign-farm logic as the AI table.
  loss: { xp: 10, coins: 0 },
};

/** What a finished online 1v1 game pays the player of `color`. */
export function rewardForPvp(input: {
  result: GameResult;
  color: Color;
  plies: number;
}): Reward {
  const outcome = outcomeFor(input.result, input.color);

  if (outcome === null || input.plies < MIN_REWARDED_PLIES) {
    return NOTHING;
  }

  return PVP_REWARD[outcome];
}

export type StatsDelta = {
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  topWinStreak: number;
  rating: number;
};

/**
 * The player's stats row after a game, given the row before it.
 *
 * `rating` is the already-decided new rating — `ratingAfter` for an AI game,
 * `ratingAgainst` the opponent for a PvP one — because which opponent a rating
 * moved against is the caller's business, not the record-keeping's.
 */
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
  rating: number,
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
    rating,
  };
}

/** Re-export so the reward pipeline and the client agree on one curve. */
export { levelFor };
