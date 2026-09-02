import { DEFAULT_EXPORT_DIR } from "../../lib/pgn-files";
import type { Keymap } from "../../providers/keymap";

export const TITLE = "Analysis";

export const SUBTITLE = "Step through a finished game with the engine";

export const WIDTH = 62;

export const HISTORY_KEYMAP: Keymap = {
  title: "Analysis — your games",
  sections: [
    {
      keys: [
        { keys: "↑↓ / jk", label: "browse" },
        { keys: "enter / space", label: "review the highlighted game" },
        { keys: "e", label: `write it out as a PGN, to ${DEFAULT_EXPORT_DIR}` },
        { keys: "i", label: "read a PGN file back in" },
        { keys: "r", label: "refresh" },
      ],
    },
  ],
};

const REVIEW_KEYMAP: Keymap = {
  title: "Analysis — reviewing a game",
  escape: "back to the game list",
  sections: [
    {
      title: "Step through it",
      keys: [
        { keys: "←→ / hl", label: "one move back, one move on" },
        { keys: "home / end", label: "the start, the final position" },
        { keys: "g / shift+g", label: "the same pair, for vim hands" },
        { keys: "n / p", label: "the next and previous mistake" },
        { keys: "f", label: "flip the board" },
      ],
    },
    {
      title: "Take it away",
      keys: [
        {
          keys: "e",
          label: `write the game out as a PGN, to ${DEFAULT_EXPORT_DIR}`,
        },
        { keys: "y", label: "copy the position you are looking at, as a FEN" },
        { keys: "shift+y", label: "copy the whole game as a PGN" },
      ],
    },
  ],
};

export const IMPORT_KEYMAP: Keymap = {
  title: "Analysis — read a PGN in",
  escape: "back, without importing",
  sections: [
    {
      keys: [
        { keys: "", label: "type the path to a .pgn file" },
        { keys: "enter", label: "read it and review the game" },
      ],
    },
  ],
};
