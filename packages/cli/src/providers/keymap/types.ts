export type KeyHelp = {
  keys: string;
  label: string;
};

export type KeymapSection = {
  title?: string;
  keys: KeyHelp[];
};

export type Keymap = {
  title: string;
  sections: KeymapSection[];
  escape?: string | null;
};
