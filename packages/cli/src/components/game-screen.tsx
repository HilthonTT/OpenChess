import type { ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import { useUITheme } from "../providers/theme";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";

interface GameScreenProps {
  title: string;
  subtitle?: string;
  width?: number;
  onEscape?: () => boolean;
  footer?: ReactNode;
  children?: ReactNode;
}

export function GameScreen({
  title,
  subtitle,
  width = 48,
  onEscape,
  footer,
  children,
}: GameScreenProps) {
  const theme = useUITheme();
  const navigate = useNavigate();
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (key.name === "escape" && !onEscape?.()) {
      void navigate("/");
    }
  });

  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      flexGrow={1}
      gap={1}
      width="100%"
      height="100%"
    >
      <box
        flexDirection="column"
        alignItems="center"
        border
        borderStyle="rounded"
        borderColor={theme.faint}
        title={` ${title} `}
        titleAlignment="center"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
        width={width}
      >
        {subtitle ? <text fg={theme.dim}>{subtitle}</text> : null}
        {children}
      </box>
      <text>
        {footer}
        <span fg={theme.cream}>esc</span>
        <span fg={theme.faint}> back to menu</span>
      </text>
    </box>
  );
}
