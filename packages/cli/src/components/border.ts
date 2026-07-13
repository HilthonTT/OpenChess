export const EmptyBorder = {
  topLeft: "",
  bottomLeft: "",
  vertical: "",
  topRight: "",
  bottomRight: "",
  horizontal: " ",
  bottomT: "",
  topT: "",
  cross: "",
  leftT: "",
  rightT: "",
};

export const SplitBorderChars = {
  ...EmptyBorder,
  vertical: "┃",
};

/**
 * A bare horizontal line with no corner glyphs. Paired with `border={["top"]}`
 * it renders as a rule across a box rather than the top of a frame.
 */
export const RuleBorderChars = {
  ...EmptyBorder,
  horizontal: "─",
};
