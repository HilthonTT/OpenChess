import type { PuzzleRushMode } from "@openchess/database";

export const RUSH_MISS_LIMIT = 3;

const RUSH_START_RATING = 600;

const RUSH_RATING_STEP = 35;

const RUSH_MAX_RATING = 2600;

export function rushRatingTarget(solved: number): number {
  return Math.min(
    RUSH_MAX_RATING,
    RUSH_START_RATING + Math.max(0, solved) * RUSH_RATING_STEP,
  );
}

export type RushReward = {
  xp: number;
  coins: number;
};

const XP_PER_SOLVE: Record<PuzzleRushMode, number> = {
  THREE_MINUTE: 4,
  FIVE_MINUTE: 4,
  SURVIVAL: 3,
};

const COINS_PER_SOLVE: Record<PuzzleRushMode, number> = {
  THREE_MINUTE: 2,
  FIVE_MINUTE: 2,
  SURVIVAL: 1,
};

const MILESTONES: ReadonlyArray<{ at: number; xp: number; coins: number }> = [
  { at: 10, xp: 15, coins: 10 },
  { at: 20, xp: 40, coins: 25 },
  { at: 30, xp: 90, coins: 60 },
];

export function rushReward(solved: number, mode: PuzzleRushMode): RushReward {
  if (solved <= 0) {
    return { xp: 0, coins: 0 };
  }

  let xp = solved * XP_PER_SOLVE[mode];
  let coins = solved * COINS_PER_SOLVE[mode];

  for (const milestone of MILESTONES) {
    if (solved >= milestone.at) {
      xp += milestone.xp;
      coins += milestone.coins;
    }
  }

  return { xp, coins };
}
