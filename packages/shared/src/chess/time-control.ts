/**
 * Time controls, the one place the server and the CLI agree on what a clock is.
 *
 * A game is untimed when it carries no time control at all; the presets below
 * are the only clocks a new game can pick. The server stores a game's clock as
 * a bare `initialSeconds`/`incrementSeconds` pair so the record does not depend
 * on this table, and `timeControlFor` names such a pair back into a preset.
 */

export type TimeControlKey = "bullet" | "blitz" | "rapid";

export type TimeControl = {
  key: TimeControlKey;
  /** Short label, e.g. "Blitz". */
  name: string;
  /** Full label with the clock, e.g. "Blitz 3+2". */
  label: string;
  /** Starting time on each side's clock, in seconds. */
  initialSeconds: number;
  /** Seconds added to a side's clock each time it completes a move. */
  incrementSeconds: number;
};

export const TIME_CONTROLS: Record<TimeControlKey, TimeControl> = {
  bullet: {
    key: "bullet",
    name: "Bullet",
    label: "Bullet 1+0",
    initialSeconds: 60,
    incrementSeconds: 0,
  },
  blitz: {
    key: "blitz",
    name: "Blitz",
    label: "Blitz 3+2",
    initialSeconds: 180,
    incrementSeconds: 2,
  },
  rapid: {
    key: "rapid",
    name: "Rapid",
    label: "Rapid 10+5",
    initialSeconds: 600,
    incrementSeconds: 5,
  },
};

/** Presets in the order they are offered, fastest first. */
export const TIME_CONTROL_KEYS: TimeControlKey[] = ["bullet", "blitz", "rapid"];

/**
 * Name a stored clock back into a preset, or null when it matches none — a
 * game's `initialSeconds`/`incrementSeconds` is the source of truth, and a
 * clock that predates a preset edit should still render as `initial+increment`
 * rather than borrow a label it no longer matches.
 */
export function timeControlFor(
  initialSeconds: number,
  incrementSeconds: number,
): TimeControl | null {
  for (const key of TIME_CONTROL_KEYS) {
    const preset = TIME_CONTROLS[key];
    if (
      preset.initialSeconds === initialSeconds &&
      preset.incrementSeconds === incrementSeconds
    ) {
      return preset;
    }
  }
  return null;
}

/**
 * A clock reading. Minutes and seconds above ten seconds (`2:05`), tenths
 * below it (`9.4`) — the same threshold most chess clocks switch at, so the
 * last few seconds are legible enough to move on.
 */
export function formatClock(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = clamped / 1000;

  if (totalSeconds < 10) {
    return totalSeconds.toFixed(1);
  }

  const whole = Math.floor(totalSeconds);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
