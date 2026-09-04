import { useKeyboard } from "@opentui/react";
import type { Game } from "@openchess/shared";
import { PROMOTION_CHOICES } from "../components/game-panels";
import { copyFen, copyPgn, type PgnDetails } from "../lib/copy-game";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { isHelpKey } from "../providers/keymap/key";
import type { CommitMove, PendingPromotion } from "./use-move-selection";

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
  copy?: {
    game: Game;
    pgn?: PgnDetails;
    refuse?: string | null;
    onNote: (note: string) => void;
  };
  before?: (keyName: string) => void;
  onKey?: (keyName: string) => void;
}) {
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
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
