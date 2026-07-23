import { useEffect, useRef, useState } from "react";
import type { Color } from "@openchess/shared";

/** The committed clock the server hands back on a game view. */
export type ClockSnapshot = {
  whiteMs: number;
  blackMs: number;
  turnStartedAt: string;
  running: Color;
};

export type LiveClock = { whiteMs: number; blackMs: number };

/** How often the ticking side's reading is refreshed on screen. */
const TICK_MS = 250;

/**
 * Turns the server's committed clock into live, ticking readings.
 *
 * The side to move is charged against `turnStartedAt`, so its number counts
 * down in real time; the idle side holds. When the running side reaches zero
 * `onExpire` fires once with that colour — the screens turn it into a flag
 * call, letting the server settle the game. A finished game (`over`) freezes
 * both readings at the committed snapshot rather than ticking past it.
 */
export function useClock({
  clock,
  over,
  onExpire,
}: {
  clock: ClockSnapshot | null;
  over: boolean;
  onExpire?: (color: Color) => void;
}): LiveClock | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const onExpireRef = useRef(onExpire);
  /** One-shot latch so a flag is reported once per turn, not every tick. */
  const firedRef = useRef(false);

  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  // A fresh turn — a move committed, or a whole new clock — re-arms the latch.
  const turnKey = clock ? `${clock.running}:${clock.turnStartedAt}` : null;
  useEffect(() => {
    firedRef.current = false;
  }, [turnKey]);

  // `turnStartedAt` is server time; subtracting it from the local clock bakes
  // any skew between the two into every reading. A machine running a minute
  // fast would show the opponent flagged the moment their turn starts — and
  // fire a doomed flag claim each turn. Each turn boundary observes
  // `local now − server turnStartedAt`, which is skew plus delivery delay;
  // the minimum across the game is the best skew estimate available without
  // a time API, and it's discounted from elapsed below.
  const [skewMs, setSkewMs] = useState<number | null>(null);
  useEffect(() => {
    if (!clock) {
      return;
    }
    const offset = Date.now() - Date.parse(clock.turnStartedAt);
    setSkewMs((current) =>
      current === null ? offset : Math.min(current, offset),
    );
    // Sampled once per turn: mid-turn refetches of the same snapshot carry the
    // same turnStartedAt but a later arrival time, which is not skew.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnKey]);

  // Only a live, timed game needs a heartbeat; a frozen or untimed one is still.
  const ticking = clock !== null && !over;
  useEffect(() => {
    if (!ticking) {
      return;
    }
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [ticking]);

  const started = clock ? Date.parse(clock.turnStartedAt) : 0;
  const elapsed =
    clock && !over ? Math.max(0, nowMs - started - (skewMs ?? 0)) : 0;

  const whiteMs = clock
    ? clock.running === "w"
      ? Math.max(0, clock.whiteMs - elapsed)
      : clock.whiteMs
    : 0;
  const blackMs = clock
    ? clock.running === "b"
      ? Math.max(0, clock.blackMs - elapsed)
      : clock.blackMs
    : 0;

  const runningRemaining =
    clock === null ? 1 : clock.running === "w" ? whiteMs : blackMs;

  useEffect(() => {
    if (!clock || over) {
      return;
    }
    if (runningRemaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      onExpireRef.current?.(clock.running);
    }
  }, [clock, over, runningRemaining]);

  return clock ? { whiteMs, blackMs } : null;
}
