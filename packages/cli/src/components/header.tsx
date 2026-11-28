import { useUITheme } from "../providers/theme";

export function Header() {
  const theme = useUITheme();

  return (
    <box flexDirection="column" alignItems="center" flexShrink={0}>
      {/* Never squeeze the logo: a short terminal would otherwise cut its shadow
          row and draw the tagline over it. */}
      <box flexDirection="row" alignItems="center" gap={1} flexShrink={0}>
        <ascii-font font="block" text="Open" color={theme.walnut} />
        <ascii-font font="block" text="Chess" color={theme.cream} />
      </box>
      <box>
        <text>
          <span fg={theme.faint}>────</span>
          <span fg={theme.walnut}> ♞ &nbsp;</span>
          <span fg={theme.dim}>chess, in your terminal</span>
          <span fg={theme.walnut}> ♞ </span>
          <span fg={theme.faint}>────</span>
        </text>
      </box>
    </box>
  );
}
