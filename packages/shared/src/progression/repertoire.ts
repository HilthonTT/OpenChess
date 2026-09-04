export type ReviewGrade = "again" | "good" | "easy";

export type ReviewState = {
  ease: number;
  intervalDays: number;
  reviews: number;
  lapses: number;
  streak: number;
};

export const NEW_LINE: ReviewState = {
  ease: 2.5,
  intervalDays: 0,
  reviews: 0,
  lapses: 0,
  streak: 0,
};

export const MIN_EASE = 1.3;

export const MAX_INTERVAL_DAYS = 180;

const EASE_DELTA: Record<ReviewGrade, number> = {
  again: -0.2,
  good: 0,
  easy: 0.15,
};

const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 4;

export function reviewLine(
  before: ReviewState,
  grade: ReviewGrade,
): ReviewState {
  const ease = Math.max(MIN_EASE, before.ease + EASE_DELTA[grade]);
  const reviews = before.reviews + 1;

  if (grade === "again") {
    return {
      ease,
      intervalDays: 0,
      reviews,
      lapses: before.lapses + 1,
      streak: 0,
    };
  }

  const streak = before.streak + 1;

  const intervalDays =
    streak === 1
      ? FIRST_INTERVAL_DAYS
      : streak === 2
        ? SECOND_INTERVAL_DAYS
        : Math.round(before.intervalDays * ease);

  return {
    ease,
    intervalDays: Math.min(MAX_INTERVAL_DAYS, Math.max(1, intervalDays)),
    reviews,
    lapses: before.lapses,
    streak,
  };
}

export function nextDue(state: ReviewState, at: Date): Date {
  const due = new Date(at.getTime());
  due.setUTCDate(due.getUTCDate() + state.intervalDays);
  return due;
}

export const EASY_MS_PER_MOVE = 3_000;

export function gradeFor(input: {
  mistakes: number;
  msSpent: number | null;
  moves: number;
}): ReviewGrade {
  if (input.mistakes > 0) {
    return "again";
  }

  if (input.msSpent === null || input.moves <= 0) {
    return "good";
  }

  return input.msSpent <= input.moves * EASY_MS_PER_MOVE ? "easy" : "good";
}

export const MAX_REPERTOIRE_LINES = 120;

export const MAX_REPERTOIRE_PLIES = 30;

export function reviewXp(input: { grade: ReviewGrade; moves: number }): number {
  if (input.grade === "again") {
    return 0;
  }

  return Math.min(30, Math.max(2, input.moves * 2));
}
