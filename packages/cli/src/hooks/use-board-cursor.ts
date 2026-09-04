import { useCallback, useState } from "react";
import { fileOf, rankOf, squareAt } from "@openchess/shared";
import type { Color } from "@openchess/shared";

function clamp(value: number): number {
  return Math.max(0, Math.min(7, value));
}

export function homeSquare(color: Color): number {
  return squareAt(4, color === "w" ? 1 : 6);
}

export function useBoardCursor({
  initialSquare,
  initiallyFlipped = false,
}: {
  initialSquare: number;
  initiallyFlipped?: boolean;
}) {
  const [cursor, setCursor] = useState(initialSquare);
  const [flipped, setFlipped] = useState(initiallyFlipped);

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      const sign = flipped ? -1 : 1;
      const x = clamp(fileOf(cursor) + dx * sign);
      const y = clamp(rankOf(cursor) + dy * sign);
      setCursor(squareAt(x, y));
    },
    [cursor, flipped],
  );

  const toggleFlipped = useCallback(() => setFlipped((value) => !value), []);

  const placeCursor = useCallback((square: number) => setCursor(square), []);

  const resetCursor = useCallback(
    () => setCursor(initialSquare),
    [initialSquare],
  );

  return {
    cursor,
    flipped,
    moveCursor,
    placeCursor,
    toggleFlipped,
    setFlipped,
    resetCursor,
  };
}
