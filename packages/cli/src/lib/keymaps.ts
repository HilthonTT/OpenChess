import type { KeyHelp } from "../providers/keymap/types";

/**
 * The parts of a keymap more than one screen has, kept in one place so the
 * board's cursor keys are not described five slightly different ways.
 *
 * Screens spread these into their own sections rather than being handed a
 * finished keymap: what is shared is the cursor and the clipboard, and every
 * screen's own keys are the interesting half.
 */

/** Identical wherever there is a live board and a cursor on it. */
export const BOARD_KEYS: KeyHelp[] = [
  { keys: "↑↓←→ / hjkl", label: "move the cursor" },
  { keys: "enter / space", label: "pick a piece up, or play the move" },
  { keys: "q r b n", label: "promote, once a pawn gets there" },
  { keys: "f", label: "flip the board" },
];

/** The clipboard pair, on the screens allowed to reach it. */
export const COPY_KEYS: KeyHelp[] = [
  { keys: "y", label: "copy the position as a FEN" },
  { keys: "shift+y", label: "copy the game as a PGN" },
];

/**
 * Escape at a board has a step before the one every other screen has: it puts
 * down whatever the player is holding, and only then leaves.
 */
export const BOARD_ESCAPE = "cancel the selection, then back to the menu";

/** Browsing a list of rows, which several screens do the same way. */
export const LIST_KEYS: KeyHelp[] = [
  { keys: "↑↓ / jk", label: "browse" },
  { keys: "home / end", label: "jump to the first or last row" },
  { keys: "g / shift+g", label: "the same pair, for vim hands" },
];
