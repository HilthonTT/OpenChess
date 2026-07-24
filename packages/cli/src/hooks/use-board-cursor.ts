import { useCallback, useState } from "react";
import { fileOf, rankOf, squareAt } from "@openchess/shared";
import type { Color } from "@openchess/shared";

/** Keep a file or rank coordinate on the board. */
function clamp(value: number): number {
  return Math.max(0, Math.min(7, value));
}

/** The king's-pawn square on your own second rank — where the cursor starts. */
export function homeSquare(color: Color): number {
  return squareAt(4, color === "w" ? 1 : 6);
}

/**
 * The square the player is standing on, plus the flip state — held together
 * because flipping decides which way the arrow keys move the cursor.
 */
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
      // Flipping the board flips which way "up" moves the cursor, so the arrow
      // keys always agree with what the player sees.
      const sign = flipped ? -1 : 1;
      const x = clamp(fileOf(cursor) + dx * sign);
      const y = clamp(rankOf(cursor) + dy * sign);
      setCursor(squareAt(x, y));
    },
    [cursor, flipped],
  );

  const toggleFlipped = useCallback(() => setFlipped((value) => !value), []);

  /** Jump the cursor somewhere specific — where a hint points, for instance. */
  const placeCursor = useCallback((square: number) => setCursor(square), []);

  /** Back to the opening square, for a fresh game on the same screen. */
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
    resetCursor,
  };
}
