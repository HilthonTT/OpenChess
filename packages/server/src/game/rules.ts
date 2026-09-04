import type {
  ClockPreset,
  Difficulty,
  OfferSide,
  GameResult,
} from "@openchess/database";
import {
  isDraw,
  levelFor,
  personalityFor,
  type Color,
  type Difficulty as EngineDifficulty,
  type GameStatus,
  type Personality,
  type TimeControlKey,
} from "@openchess/shared";

const ENGINE_DIFFICULTY: Record<Difficulty, EngineDifficulty> = {
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
};

export function toEngineDifficulty(difficulty: Difficulty): EngineDifficulty {
  return ENGINE_DIFFICULTY[difficulty];
}

const STORED_DIFFICULTY: Record<EngineDifficulty, Difficulty> = {
  easy: "EASY",
  medium: "MEDIUM",
  hard: "HARD",
};

export function toStoredDifficulty(difficulty: EngineDifficulty): Difficulty {
  return STORED_DIFFICULTY[difficulty];
}

export function botFor(row: {
  difficulty: Difficulty | null;
  personality: string | null;
}): Personality {
  return personalityFor(
    row.personality,
    toEngineDifficulty(row.difficulty ?? "MEDIUM"),
  );
}

const CLOCK_PRESET: Record<ClockPreset, TimeControlKey> = {
  BULLET: "bullet",
  BLITZ: "blitz",
  RAPID: "rapid",
};

const STORED_CLOCK: Record<TimeControlKey, ClockPreset> = {
  bullet: "BULLET",
  blitz: "BLITZ",
  rapid: "RAPID",
};

export function toTimeControlKey(
  clock: ClockPreset | null,
): TimeControlKey | null {
  return clock === null ? null : CLOCK_PRESET[clock];
}

export function toClockPreset(
  timeControl: TimeControlKey | null | undefined,
): ClockPreset | null {
  return timeControl ? STORED_CLOCK[timeControl] : null;
}

const OFFER_SIDE: Record<Color, OfferSide> = { w: "WHITE", b: "BLACK" };

const OFFER_COLOR: Record<OfferSide, Color> = { WHITE: "w", BLACK: "b" };

export function toOfferSide(color: Color): OfferSide {
  return OFFER_SIDE[color];
}

export function toOfferColor(side: OfferSide | null): Color | null {
  return side === null ? null : OFFER_COLOR[side];
}

export function pliesToTakeBack(ply: number, offerer: Color): number | null {
  if (ply < 1) {
    return null;
  }

  const lastMover: Color = ply % 2 === 1 ? "w" : "b";

  if (lastMover === offerer) {
    return 1;
  }

  return ply >= 2 ? 2 : null;
}

export type Outcome = "win" | "loss" | "draw";

export type Reward = {
  xp: number;
  coins: number;
};

export const BOT_RATING: Record<Difficulty, number> = {
  EASY: 800,
  MEDIUM: 1200,
  HARD: 1600,
};

export const AI_GAMES_AFFECT_RATING = false;

const K_FACTOR = 24;

export const MIN_REWARDED_PLIES = 10;

const BASE_REWARD: Record<Outcome, Reward> = {
  win: { xp: 30, coins: 20 },
  draw: { xp: 12, coins: 8 },
  loss: { xp: 5, coins: 0 },
};

const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  EASY: 1,
  MEDIUM: 1.5,
  HARD: 2,
};

const NOTHING: Reward = { xp: 0, coins: 0 };

export function resultFor(status: GameStatus, turn: Color): GameResult | null {
  if (status === "checkmate") {
    return turn === "w" ? "BLACK_WIN" : "WHITE_WIN";
  }

  if (isDraw(status)) {
    return "DRAW";
  }

  return null;
}

export function resultForResignation(player: Color): GameResult {
  return player === "w" ? "BLACK_WIN" : "WHITE_WIN";
}

export function resultForTimeout(player: Color): GameResult {
  return resultForResignation(player);
}

export type ClockState = {
  whiteTimeMs: number;
  blackTimeMs: number;
};

export function timeOf(clock: ClockState, color: Color): number {
  return color === "w" ? clock.whiteTimeMs : clock.blackTimeMs;
}

export function hasFlagged(
  clock: ClockState,
  color: Color,
  elapsedMs: number,
): boolean {
  return timeOf(clock, color) - elapsedMs <= 0;
}

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

export function clockAfterTakeback(input: {
  clock: ClockState;
  running: Color;
  elapsedMs: number;
  plies: number;
  incrementSeconds: number;
  incrementFor?: Color;
}): ClockState {
  const banked: ClockState =
    input.running === "w"
      ? {
          whiteTimeMs: Math.max(0, input.clock.whiteTimeMs - input.elapsedMs),
          blackTimeMs: input.clock.blackTimeMs,
        }
      : {
          whiteTimeMs: input.clock.whiteTimeMs,
          blackTimeMs: Math.max(0, input.clock.blackTimeMs - input.elapsedMs),
        };

  const increment = input.incrementSeconds * 1000;

  let white = banked.whiteTimeMs;
  let black = banked.blackTimeMs;
  let mover: Color = input.running === "w" ? "b" : "w";

  for (let i = 0; i < input.plies; i += 1) {
    const credited =
      input.incrementFor === undefined || input.incrementFor === mover;
    if (credited && mover === "w") {
      white = Math.max(0, white - increment);
    } else if (credited) {
      black = Math.max(0, black - increment);
    }
    mover = mover === "w" ? "b" : "w";
  }

  return { whiteTimeMs: white, blackTimeMs: black };
}

export function outcomeFor(result: GameResult, color: Color): Outcome | null {
  if (result === "ABORTED") {
    return null;
  }

  if (result === "DRAW") {
    return "draw";
  }

  const winner: Color = result === "WHITE_WIN" ? "w" : "b";
  return winner === color ? "win" : "loss";
}

export function expectedScore(rating: number, opponent: number): number {
  return 1 / (1 + 10 ** ((opponent - rating) / 400));
}

const SCORE: Record<Outcome, number> = { win: 1, draw: 0.5, loss: 0 };

export function ratingAgainst(
  rating: number,
  opponent: number,
  outcome: Outcome,
): number {
  const expected = expectedScore(rating, opponent);
  const delta = K_FACTOR * (SCORE[outcome] - expected);

  const rounded = delta >= 0 ? Math.ceil(delta) : Math.floor(delta);

  return Math.max(100, rating + rounded);
}

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

export function rewardFor(input: {
  result: GameResult;
  color: Color;
  difficulty: Difficulty;
  plies: number;
  takebacks?: number;
}): Reward {
  const outcome = outcomeFor(input.result, input.color);

  if (
    outcome === null ||
    input.plies < MIN_REWARDED_PLIES ||
    (input.takebacks ?? 0) > 0
  ) {
    return NOTHING;
  }

  const base = BASE_REWARD[outcome];
  const multiplier = DIFFICULTY_MULTIPLIER[input.difficulty];

  return {
    xp: Math.round(base.xp * multiplier),
    coins: Math.round(base.coins * multiplier),
  };
}

const PVP_REWARD: Record<Outcome, Reward> = {
  win: { xp: 70, coins: 45 },
  draw: { xp: 25, coins: 0 },
  loss: { xp: 10, coins: 0 },
};

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

export { levelFor };
