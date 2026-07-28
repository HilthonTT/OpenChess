import type { PuzzleRushMode } from "@openchess/database";

/**
 * What a Puzzle Rush run is worth, and how hard it gets — kept pure beside the
 * service that runs it, the same split `game/rules.ts` and `puzzle/rules.ts`
 * keep. Nothing here touches the database, which is what makes it the part
 * worth having tests for.
 */

/** Mistakes a run survives. The third one ends it. */
export const RUSH_MISS_LIMIT = 3;

/** Where the ramp starts, in the same Elo the puzzle ladder uses. */
const RUSH_START_RATING = 600;

/** How much harder each solve makes the next one. */
const RUSH_RATING_STEP = 35;

/**
 * The ceiling. Past this the corpus thins out badly and a run would stall on
 * "no puzzle found" rather than on the player, which is not the same thing.
 */
const RUSH_MAX_RATING = 2600;

/**
 * The rating to look for at a given score.
 *
 * Linear rather than accelerating: a ramp that got hard quickly would make the
 * whole score depend on the first thirty seconds, and the point of a rush is
 * that it keeps going until you make a mistake.
 */
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

/**
 * What a finished run pays.
 *
 * Per solve, and modest per solve: a rush serves puzzles the player may already
 * have seen, and pays nothing towards the puzzle rating, so it has to be worth
 * less than the rated queue or it would simply replace it. A run that solved
 * nothing pays nothing, which is also what stops a start-and-abandon loop from
 * being worth anything.
 *
 * Survival pays a shade less per solve than the timed modes: with no clock on
 * it, a patient player can run one for as long as their nerve holds, so the
 * same rate would make it the only mode anybody played.
 */
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

/**
 * A bonus at the milestones, so a good run is worth pushing for rather than
 * being worth exactly one more puzzle than a mediocre one.
 */
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
