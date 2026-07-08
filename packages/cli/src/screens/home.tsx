import { useCallback } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { Header } from "../components/header";
import { Menu } from "../components/menu";
import { theme } from "../theme";
import type { MenuItem } from "../components/menu/types";
import { useToast } from "../providers/toast";
import { useDialog } from "../providers/dialog";

export function Home() {
  const renderer = useRenderer();
  const toast = useToast();
  const dialog = useDialog();

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
    if (key.name === "q") {
      renderer.destroy();
      process.exit(0);
    }
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
      </text>
    </box>
  );
}
