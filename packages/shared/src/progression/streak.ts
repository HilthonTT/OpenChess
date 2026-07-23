/**
 * The daily check-in streak.
 *
 * Lives in the shared package for the same reason the XP curve does: the server
 * decides when a streak advances and what it pays, the client renders the number
 * and the countdown, and the two have to agree on exactly where a day boundary
 * falls.
 *
 * Days are UTC calendar days, named `YYYY-MM-DD`. A local-timezone boundary
 * would be friendlier — a player in Auckland rolls over mid-afternoon UTC — but
 * only the server can be trusted to say what day it is, and a streak that pays
 * coins is precisely the thing a user would move their clock for. One clock,
 * everyone's, is the trade that keeps the payout honest.
 */

/** The UTC calendar day `at` falls on, as `YYYY-MM-DD`. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Midnight UTC on `day`, for a column the database stores as a bare date. */
export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The UTC day before `day`. */
export function previousDay(day: string): string {
  const date = dayStart(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return utcDay(date);
}

export type Streak = {
  /** Consecutive days checked in, including today once claimed. */
  current: number;
  /** The longest run this player has ever put together. */
  best: number;
  /** The last day claimed, or null for a player who never has. */
  lastDay: string | null;
};

export type StreakAdvance = {
  streak: Streak;
  /**
   * False when `today` had already been claimed, in which case `streak` is
   * returned untouched and nothing is owed.
   */
  claimed: boolean;
};

/**
 * The streak after a check-in on `today`.
 *
 * Yesterday continues the run. Anything else — a gap of one day or a hundred, a
 * player who has never checked in, or a `lastDay` somehow in the future — starts
 * a fresh run at day one, which is the only reading that cannot be gamed by a
 * clock that has gone backwards.
 */
export function advanceStreak(before: Streak, today: string): StreakAdvance {
  if (before.lastDay === today) {
    return { streak: before, claimed: false };
  }

  const continues = before.lastDay === previousDay(today);
  const current = continues ? before.current + 1 : 1;

  return {
    streak: {
      current,
      best: Math.max(before.best, current),
      lastDay: today,
    },
    claimed: true,
  };
}

/**
 * The day at which the check-in reward stops growing.
 *
 * Capped on purpose. A curve that kept climbing would eventually make opening
 * the app worth more than playing a game in it, which is the wrong thing for a
 * chess program to pay for. At the cap a check-in is worth roughly half a won
 * online game — a reason to come back, never a reason to stay away.
 */
export const STREAK_REWARD_CAP_DAY = 7;

const STREAK_BASE = { xp: 15, coins: 5 };
const STREAK_STEP = { xp: 5, coins: 3 };

export type StreakReward = { xp: number; coins: number };

/** What a check-in landing on streak day `day` pays. */
export function streakReward(day: number): StreakReward {
  const clamped = Math.min(Math.max(Math.floor(day), 1), STREAK_REWARD_CAP_DAY);
  const steps = clamped - 1;

  return {
    xp: STREAK_BASE.xp + STREAK_STEP.xp * steps,
    coins: STREAK_BASE.coins + STREAK_STEP.coins * steps,
  };
}

/**
 * Whether a streak that last claimed on `lastDay` is still alive as of `today` —
 * true while it can still be extended, false once a day has been missed and the
 * next check-in will restart at one. Drives the "keep it going" copy in the CLI;
 * the payout never reads it, because `advanceStreak` decides that on its own.
 */
export function streakIsAlive(lastDay: string | null, today: string): boolean {
  return lastDay === today || lastDay === previousDay(today);
}
