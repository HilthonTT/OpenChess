/** One row of the help overlay: a keystroke, and what it does on this screen. */
export type KeyHelp = {
  /** How the keystroke is written, e.g. `shift+y`, `↑↓`, `1-4`. */
  keys: string;
  label: string;
};

/** A named group of keys — "At the board", "The draw", and so on. */
export type KeymapSection = {
  /** Heading above the group. Omitted when a screen has only one group. */
  title?: string;
  keys: KeyHelp[];
};

/** Everything `?` shows for the screen that registered it. */
export type Keymap = {
  /** Names the screen the keys belong to; the dialog's title. */
  title: string;
  sections: KeymapSection[];
  /**
   * What `esc` does here, for the section the overlay appends itself.
   * Undefined takes the default every `GameScreen` provides; `null` says the
   * screen has no escape at all, which is only true of the menu.
   */
  escape?: string | null;
};
