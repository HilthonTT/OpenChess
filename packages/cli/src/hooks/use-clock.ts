import { useEffect, useRef, useState } from "react";
import type { Color } from "@openchess/shared";

export type ClockSnapshot = {
  whiteMs: number;
  blackMs: number;
  turnStartedAt: string;
  running: Color;
};

export type LiveClock = { whiteMs: number; blackMs: number };

const TICK_MS = 250;

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
  const firedRef = useRef(false);

  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  const turnKey = clock ? `${clock.running}:${clock.turnStartedAt}` : null;
  useEffect(() => {
    firedRef.current = false;
  }, [turnKey]);

  const [skewMs, setSkewMs] = useState<number | null>(null);
  const previousTurnKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousTurnKey.current;
    previousTurnKey.current = turnKey;
    if (!clock || previous === null) {
      return;
    }
    const offset = Date.now() - Date.parse(clock.turnStartedAt);
    setSkewMs((current) =>
      current === null ? offset : Math.min(current, offset),
    );
  }, [turnKey]);

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
