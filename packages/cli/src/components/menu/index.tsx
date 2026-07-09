import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useUITheme } from "../../providers/theme";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import type { MenuItem } from "./types";
import { MENU_ITEMS } from "./menu-items";
import { TEXT_PRESENTATION } from "../pieces";

interface MenuProps {
  onSelect: (item: MenuItem) => void;
}

export function Menu({ onSelect }: MenuProps) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();
  const [index, setIndex] = useState(0);

  useKeyboard((key) => {
    // Ignore input while a dialog (or any higher layer) is open so selecting
    // a theme with ENTER doesn't also activate the highlighted menu item.
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setIndex((i) => (i - 1 + MENU_ITEMS.length) % MENU_ITEMS.length);
    } else if (key.name === "down" || key.name === "j") {
      setIndex((i) => (i + 1) % MENU_ITEMS.length);
    } else if (key.name === "return") {
      const item = MENU_ITEMS[index];
      if (item) {
        onSelect(item);
      }
    } else if (/^[1-9]$/.test(key.name)) {
      const item = MENU_ITEMS[Number(key.name) - 1];
      if (item) {
        setIndex(Number(key.name) - 1);
        onSelect(item);
      }
    }
  });

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.faint}
      title=" Select a game mode "
      titleAlignment="center"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      gap={1.2}
      width={48}
    >
      {MENU_ITEMS.map((item, i) => {
        const selected = i === index;
        return (
          <box
            onMouseDown={() => {}}
            key={item.id}
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected ? theme.selectionBg : undefined}
          >
            <text>
              <span fg={selected ? theme.gold : theme.faint}>
                {selected ? "❯ " : "  "}
              </span>
              <span fg={selected ? theme.gold : theme.walnut}>
                {`${item.icon}${TEXT_PRESENTATION}  `}
              </span>
            </text>
            <box flexDirection="column" flexGrow={1}>
              <text fg={selected ? theme.cream : theme.dim}>
                {selected ? <b>{item.title}</b> : item.title}
              </text>
              <text fg={selected ? theme.dim : theme.faint}>
                {item.description}
              </text>
            </box>
            <text fg={selected ? theme.walnut : theme.faint}>{i + 1}</text>
          </box>
        );
      })}
    </box>
  );
}
