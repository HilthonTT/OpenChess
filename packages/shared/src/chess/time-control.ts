export type TimeControlKey = "bullet" | "blitz" | "rapid";

export type TimeControl = {
  key: TimeControlKey;
  name: string;
  label: string;
  initialSeconds: number;
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

export const TIME_CONTROL_KEYS: TimeControlKey[] = ["bullet", "blitz", "rapid"];

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
