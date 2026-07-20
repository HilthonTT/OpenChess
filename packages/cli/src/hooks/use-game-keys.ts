import { useKeyboard } from "@opentui/react";
import { PROMOTION_CHOICES } from "../components/game-panels";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import type { CommitMove, PendingPromotion } from "./use-move-selection";

/**
 * The keys every board screen shares: cursor movement, select/confirm, the
 * promotion picker, and flipping. While the promotion prompt is open it
 * swallows every key, exactly as the screens did inline.
 */
export function useGameKeys({
  selection,
  cursor,
  commit,
  before,
  onKey,
}: {
  selection: {
    promotion: PendingPromotion | null;
    confirm: (commit: CommitMove) => void;
  };
  cursor: {
    moveCursor: (dx: number, dy: number) => void;
    toggleFlipped: () => void;
  };
  commit: CommitMove;
  /** Runs ahead of the shared keys — the resign-confirm screens cancel here. */
  before?: (keyName: string) => void;
  /** Screen-specific keys; sees only what the shared set didn't consume. */
  onKey?: (keyName: string) => void;
}) {
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    // Game keys belong to the screen itself; stay quiet under any open dialog.
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    const { promotion } = selection;
    if (promotion) {
      const choice = PROMOTION_CHOICES.find(([piece]) => piece === key.name);
      if (choice) {
        void commit(promotion.from, promotion.to, choice[0]);
      }
      return;
    }

    before?.(key.name);

    switch (key.name) {
      case "up":
      case "k":
        cursor.moveCursor(0, 1);
        return;
      case "down":
      case "j":
        cursor.moveCursor(0, -1);
        return;
      case "left":
      case "h":
        cursor.moveCursor(-1, 0);
        return;
      case "right":
      case "l":
        cursor.moveCursor(1, 0);
        return;
      case "return":
      case "space":
        selection.confirm(commit);
        return;
      case "f":
        cursor.toggleFlipped();
        return;
    }

    onKey?.(key.name);
  });
}
