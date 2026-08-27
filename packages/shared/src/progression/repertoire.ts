/**
 * Spaced repetition, for opening lines.
 *
 * Lives in the shared package for the same reason the XP curve does: the server
 * decides when a line falls due and what a review is worth, the client renders
 * the countdown, and the two have to agree on exactly where the boundary is.
 *
 * The scheduler is SM-2 with the ratings collapsed to three, because a
 * repertoire drill only produces three outcomes and asking a player to
 * self-grade one of six would be inventing information nobody has:
 *
 * - **again** — a move was wrong. The line comes back today, and its ease drops.
 * - **good** — played clean, but slowly or with a hesitation the client saw.
 * - **easy** — played clean and quickly. The interval stretches further.
 *
 * What is deliberately *not* here is any notion of partial credit. An opening
 * line is a sequence, and half of one is not half as useful — you either played
 * it or you were guessing. So one wrong move fails the whole line, however long
 * it was, which is also what stops a twenty-move line being an easier review
 * than a four-move one.
 */

export type ReviewGrade = "again" | "good" | "easy";

/** How a line stands: everything the scheduler reads and writes. */
export type ReviewState = {
  /**
   * SM-2's ease factor — how much the interval stretches on a clean review.
   * Starts at 2.5 and is floored at 1.3, below which a line is being failed so
   * often that shrinking the interval further just means seeing it every day,
   * which is what the floor already gives.
   */
  ease: number;
  /** Days until the next review. Zero means "again today". */
  intervalDays: number;
  /** How many times it has been reviewed at all, failures included. */
  reviews: number;
  /** How many of those were failures. */
  lapses: number;
  /** Consecutive clean reviews. Any failure sets it to zero. */
  streak: number;
};

/** Where every line starts: due immediately, never seen. */
export const NEW_LINE: ReviewState = {
  ease: 2.5,
  intervalDays: 0,
  reviews: 0,
  lapses: 0,
  streak: 0,
};

/** The floor on `ease`; see the type above for why it is not lower. */
export const MIN_EASE = 1.3;

/**
 * The ceiling on an interval, in days.
 *
 * Six months. Past that the scheduler is not really saying "you know this" any
 * more, it is saying "come back when the season has changed", and a repertoire
 * you last saw half a year ago is one you are relearning rather than reviewing.
 */
export const MAX_INTERVAL_DAYS = 180;

/** How much the ease moves on each grade. The middle one leaves it alone. */
const EASE_DELTA: Record<ReviewGrade, number> = {
  again: -0.2,
  good: 0,
  easy: 0.15,
};

/**
 * The first two intervals, in days, for a line being learned.
 *
 * Fixed rather than computed, exactly as SM-2 has them: the ease factor has
 * nothing to work on until there is a previous interval to multiply, and a
 * first review that jumped straight to two and a half days would be guessing.
 */
const FIRST_INTERVAL_DAYS = 1;
const SECOND_INTERVAL_DAYS = 4;

/** The state after a review of this grade. Pure; the caller stamps the dates. */
export function reviewLine(
  before: ReviewState,
  grade: ReviewGrade,
): ReviewState {
  const ease = Math.max(MIN_EASE, before.ease + EASE_DELTA[grade]);
  const reviews = before.reviews + 1;

  if (grade === "again") {
    return {
      ease,
      // Zero, not "tomorrow": a line you have just got wrong is one to play
      // again while you can still see why, and the whole cost of being wrong
      // in a drill is having to do it once more.
      intervalDays: 0,
      reviews,
      lapses: before.lapses + 1,
      streak: 0,
    };
  }

  const streak = before.streak + 1;

  // The two fixed steps first, then multiplication. `streak` and not `reviews`
  // drives this, so a line that lapses is relearned from the short intervals
  // rather than snapping back to the month it had reached before it was
  // forgotten — which is the whole point of tracking lapses separately.
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

/** When a line reviewed at `at` next falls due. */
export function nextDue(state: ReviewState, at: Date): Date {
  const due = new Date(at.getTime());
  due.setUTCDate(due.getUTCDate() + state.intervalDays);
  return due;
}

/**
 * The grade a drill earns.
 *
 * The client reports what happened — how many moves were wrong, and how long it
 * took — and this is the one place that turns those into a rating, so the
 * server and the screen can never disagree about what "easy" meant.
 *
 * Any mistake at all is `again`; see the module note. The split between `good`
 * and `easy` is a time budget per move, generous enough that thinking about a
 * position is not punished and tight enough that a line you had to reconstruct
 * from first principles does not count as known.
 */
export const EASY_MS_PER_MOVE = 3_000;

export function gradeFor(input: {
  mistakes: number;
  /** How long the whole drill took, or null when the client did not say. */
  msSpent: number | null;
  /** How many moves the player had to find. */
  moves: number;
}): ReviewGrade {
  if (input.mistakes > 0) {
    return "again";
  }

  // No timing reported is `good`, never `easy`: the benefit of the doubt runs
  // in the direction of seeing the line again sooner.
  if (input.msSpent === null || input.moves <= 0) {
    return "good";
  }

  return input.msSpent <= input.moves * EASY_MS_PER_MOVE ? "easy" : "good";
}

/**
 * How many lines one player may keep.
 *
 * A repertoire is a set of things you are actually going to review, and a
 * player with four hundred lines is not reviewing them — they are looking at a
 * backlog that will never empty, which is the failure mode every spaced
 * repetition system has. The cap is high enough to hold a real repertoire for
 * both colours and low enough that the daily queue stays finishable.
 */
export const MAX_REPERTOIRE_LINES = 120;

/**
 * The longest line the trainer will take.
 *
 * Past this it is not an opening any more, and a drill you cannot get through
 * without a mistake is one that never leaves the failing pile.
 */
export const MAX_REPERTOIRE_PLIES = 30;

/**
 * What a clean review is worth, in XP.
 *
 * Per move you had to find rather than per line, so a twenty-move Najdorf is
 * worth more than 1.e4 e5 — and capped, so a long line is not a better rate
 * than a short one for the time it takes.
 *
 * Paid only on a review that was actually *due*, which is what makes this
 * unfarmable without a separate rule: a clean review pushes the next one at
 * least a day out, so a line can pay at most once a day, and the number of
 * lines is capped. Drilling a line early is free and pays nothing, which is
 * exactly the right price for practice you asked for.
 */
export function reviewXp(input: {
  grade: ReviewGrade;
  /** How many moves the player had to find. */
  moves: number;
}): number {
  if (input.grade === "again") {
    return 0;
  }

  return Math.min(30, Math.max(2, input.moves * 2));
}
