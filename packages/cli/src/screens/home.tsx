import { useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { Header } from "../components/header";
import { Menu } from "../components/menu";
import type { MenuItem } from "../components/menu/types";
import { useToast } from "../providers/toast";
import { useDialog } from "../providers/dialog";
import { useUITheme } from "../providers/theme";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { ThemeDialogContent } from "../components/dialogs/theme-dialog";

export function Home() {
  const renderer = useRenderer();
  const toast = useToast();
  const dialog = useDialog();
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const handleSelect = useCallback(
    (menuItem: MenuItem) => {
      if (menuItem.action) {
        menuItem.action({
          exit: () => renderer.destroy(),
          toast,
          dialog,
        });
      }
    },
    [renderer, toast, dialog],
  );

  useKeyboard((key) => {
    // Only the base screen owns these shortcuts; while a dialog is open its
    // own layer handles input (e.g. typing "q" into the theme search).
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (key.name === "q") {
      renderer.destroy();
      process.exit(0);
    }
  });

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (!key.ctrl || key.name !== ".") {
      return;
    }

    dialog.open({
      title: "Select Theme",
      children: <ThemeDialogContent />,
    });
  });

  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      flexGrow={1}
      gap={2}
      position="relative"
      width="100%"
      height="100%"
    >
      <Header />
      <Menu onSelect={handleSelect} />
      <text>
        <span fg={theme.cream}>↑↓</span>
        <span fg={theme.faint}> move </span>
        <span fg={theme.cream}>enter</span>
        <span fg={theme.faint}> select </span>
        <span fg={theme.cream}>1-3</span>
        <span fg={theme.faint}> quick pick </span>
        <span fg={theme.cream}>q</span>
        <span fg={theme.faint}> quit</span>
        <span fg={theme.cream}> ctrl + .</span>
        <span fg={theme.faint}> theme</span>
      </text>
    </box>
  );
}
