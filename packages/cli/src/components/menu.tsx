import { useState } from "react";
import { useKeyboard } from "@opentui/react";
import { theme } from "../theme";

export interface MenuItem {
  id: string;
  icon: string;
  title: string;
  description: string;
}

interface MenuProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
}

export function Menu({ items, onSelect }: MenuProps) {
  const [index, setIndex] = useState(0);

  useKeyboard((key) => {
    if (key.name === "up" || key.name === "k") {
      setIndex((i) => (i - 1 + items.length) % items.length);
    } else if (key.name === "down" || key.name === "j") {
      setIndex((i) => (i + 1) % items.length);
    } else if (key.name === "return") {
      const item = items[index];
      if (item) onSelect(item);
    } else if (/^[1-9]$/.test(key.name)) {
      const item = items[Number(key.name) - 1];
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
      gap={1}
      width={48}
    >
      {items.map((item, i) => {
        const selected = i === index;
        return (
          <box
            key={item.id}
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={selected ? theme.selectionBg : undefined}
          >
            <text fg={selected ? theme.gold : theme.faint}>
              {selected ? "❯ " : "  "}
              {item.icon}
              {"  "}
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
