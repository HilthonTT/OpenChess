export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function previousDay(day: string): string {
  const date = dayStart(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return utcDay(date);
}

export type Streak = {
  current: number;
  best: number;
  lastDay: string | null;
};

export type StreakAdvance = {
  streak: Streak;
  claimed: boolean;
};

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

export const STREAK_REWARD_CAP_DAY = 7;

const STREAK_BASE = { xp: 15, coins: 5 };
const STREAK_STEP = { xp: 5, coins: 3 };

export type StreakReward = { xp: number; coins: number };

export function streakReward(day: number): StreakReward {
  const clamped = Math.min(Math.max(Math.floor(day), 1), STREAK_REWARD_CAP_DAY);
  const steps = clamped - 1;

  return {
    xp: STREAK_BASE.xp + STREAK_STEP.xp * steps,
    coins: STREAK_BASE.coins + STREAK_STEP.coins * steps,
  };
}

export function streakIsAlive(lastDay: string | null, today: string): boolean {
  return lastDay === today || lastDay === previousDay(today);
}
