import { theme } from "../theme";

export function Header() {
  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <box flexDirection="row" alignItems="center" gap={1}>
        <ascii-font font="block" text="Open" color={theme.walnut} />
        <ascii-font font="block" text="Chess" color={theme.cream} />
      </box>
      <text>
        <span fg={theme.faint}>────</span>
        <span fg={theme.walnut}> ♞ </span>
        <span fg={theme.dim}>chess, in your terminal</span>
        <span fg={theme.walnut}> ♞ </span>
        <span fg={theme.faint}>────</span>
      </text>
    </box>
  );
}
