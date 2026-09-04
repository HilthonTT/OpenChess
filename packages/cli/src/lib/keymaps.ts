import type { KeyHelp } from "../providers/keymap/types";

export const BOARD_KEYS: KeyHelp[] = [
  { keys: "↑↓←→ / hjkl", label: "move the cursor" },
  { keys: "enter / space", label: "pick a piece up, or play the move" },
  { keys: "q r b n", label: "promote, once a pawn gets there" },
  { keys: "f", label: "flip the board" },
];

export const COPY_KEYS: KeyHelp[] = [
  { keys: "y", label: "copy the position as a FEN" },
  { keys: "shift+y", label: "copy the game as a PGN" },
];

export const BOARD_ESCAPE = "cancel the selection, then back to the menu";

export const LIST_KEYS: KeyHelp[] = [
  { keys: "↑↓ / jk", label: "browse" },
  { keys: "home / end", label: "jump to the first or last row" },
  { keys: "g / shift+g", label: "the same pair, for vim hands" },
];
