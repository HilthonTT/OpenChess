import { useKeyboard } from "@opentui/react";
import type { Game } from "@openchess/shared";
import { PROMOTION_CHOICES } from "../components/game-panels";
import { copyFen, copyPgn, type PgnDetails } from "../lib/copy-game";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { isHelpKey } from "../providers/keymap/key";
import type { CommitMove, PendingPromotion } from "./use-move-selection";

/**
 * The keys every board screen shares: cursor movement, select/confirm, the
 * promotion picker, flipping, and copying the game out. While the promotion
 * prompt is open it swallows every key, exactly as the screens did inline.
 */
export function useGameKeys({
  selection,
  cursor,
  commit,
  copy,
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
  /** What `y` and `shift+y` put on the clipboard; omit to leave both unbound. */
  copy?: {
    game: Game;
    /** Headers for the PGN, from a screen that knows who is playing. */
    pgn?: PgnDetails;
    /**
     * Why copying is refused right now, if it is — shown in place of the note.
     * A game the server pays out on is not one to hand to an engine mid-move.
     */
    refuse?: string | null;
    onNote: (note: string) => void;
  };
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

    // `?` is the help overlay's, and the provider has already opened it. It is
    // swallowed here rather than left to fall through because a terminal
    // speaking the kitty protocol calls it `/` with a shift flag, and `/` is
    // the puzzle screen's theme picker — which would otherwise open behind the
    // overlay every time somebody asked for help.
    if (isHelpKey(key)) {
      return;
    }

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
      case "y":
        // Yank, as an editor spells it: the position on its own, or the whole
        // game when shifted. A screen that passes no `copy` leaves the key to
        // `onKey` rather than swallowing it.
        if (copy) {
          copy.onNote(
            copy.refuse ??
              (key.shift ? copyPgn(copy.game, copy.pgn) : copyFen(copy.game)),
          );
          return;
        }
        break;
    }

    onKey?.(key.name);
  });
}
