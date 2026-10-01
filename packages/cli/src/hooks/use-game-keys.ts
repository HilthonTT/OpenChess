import type { ParsedKey } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import type { Game, PromotionPiece } from "@openchess/shared";
import { PROMOTION_CHOICES } from "../components/game-panels";
import { copyFen, copyPgn, type PgnDetails } from "../lib/copy-game";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { isHelpKey } from "../providers/keymap/key";
import type { CommitMove, PendingPromotion } from "./use-move-selection";

const ENTRY_KEYS = new Set([":", "/"]);

function typedCharacter(key: ParsedKey): string | null {
  if (key.ctrl || key.meta) {
    return null;
  }

  const text =
    key.sequence.length === 1
      ? key.sequence
      : key.shift
        ? key.name.toUpperCase()
        : key.name;

  return /^[a-z0-9=+#-]$/i.test(text) ? text : null;
}

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
    confirm: (commit: CommitMove, at?: number) => void;
    entry: string | null;
    openEntry: () => void;
    typeEntry: (text: string) => void;
    eraseEntry: () => void;
    playTyped: (commit: CommitMove) => void;
    choosePromotion: (commit: CommitMove, choice: PromotionPiece) => void;
  };
  cursor: {
    moveCursor: (dx: number, dy: number) => void;
    toggleFlipped: () => void;
    placeCursor: (square: number) => void;
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
        selection.choosePromotion(commit, choice[0]);
      }
      return;
    }

    if (selection.entry !== null) {
      switch (key.name) {
        case "return":
          selection.playTyped(commit);
          return;
        case "backspace":
          selection.eraseEntry();
          return;
        case "escape":
          return;
      }

      const typed = typedCharacter(key);
      if (typed !== null) {
        selection.typeEntry(typed);
      }
      return;
    }

    before?.(key.name);

    if (isHelpKey(key)) {
      return;
    }

    if (ENTRY_KEYS.has(key.name) && !key.ctrl && !key.meta) {
      selection.openEntry();
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

  return (square: number) => {
    if (!isTopLayer(BASE_LAYER_ID) || selection.promotion) {
      return;
    }

    before?.("click");
    cursor.placeCursor(square);
    selection.confirm(commit, square);
  };
}
