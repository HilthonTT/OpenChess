import { Fragment, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useUITheme } from "../../providers/theme";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import type { MenuItem } from "./types";
import { TEXT_PRESENTATION } from "../pieces";
import { RuleBorderChars } from "../border";

interface MenuProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
}

export function Menu({ items, onSelect }: MenuProps) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();
  const [index, setIndex] = useState(0);

  // The account row can come and go as the session resolves; never leave the
  // cursor pointing past the end of the list.
  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  const select = (item: MenuItem | undefined) => {
    if (item && !item.disabled) {
      onSelect(item);
    }
  };

  useKeyboard((key) => {
    // Ignore input while a dialog (or any higher layer) is open so selecting
    // a theme with ENTER doesn't also activate the highlighted menu item.
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (key.name === "up" || key.name === "k") {
      setIndex((i) => (i - 1 + items.length) % items.length);
    } else if (key.name === "down" || key.name === "j") {
      setIndex((i) => (i + 1) % items.length);
    } else if (key.name === "return") {
      select(items[index]);
    } else if (/^[1-9]$/.test(key.name)) {
      const position = Number(key.name) - 1;
      const item = items[position];
      if (item) {
        setIndex(position);
        select(item);
      }
    }
  });

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={theme.faint}
      title=" Main menu "
      titleAlignment="center"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      gap={1.2}
      width={48}
    >
      {items.map((item, i) => {
        const selected = i === index;
        const dim = item.disabled;
        return (
          <Fragment key={item.id}>
            {item.dividerBefore ? (
              <box
                border={["top"]}
                customBorderChars={RuleBorderChars}
                borderColor={theme.faint}
              />
            ) : null}
            <box
              onMouseMove={() => setIndex(i)}
              onMouseDown={() => {
                setIndex(i);
                select(item);
              }}
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                selected && !dim ? theme.selectionBg : undefined
              }
            >
              <text>
                <span fg={selected && !dim ? theme.gold : theme.faint}>
                  {selected && !dim ? "❯ " : "  "}
                </span>
                <span
                  fg={dim ? theme.faint : selected ? theme.gold : theme.walnut}
                >
                  {`${item.icon}${TEXT_PRESENTATION}  `}
                </span>
              </text>
              <box flexDirection="column" flexGrow={1}>
                <text
                  fg={dim ? theme.dim : selected ? theme.cream : theme.dim}
                >
                  {selected && !dim ? <b>{item.title}</b> : item.title}
                </text>
                <text fg={selected && !dim ? theme.dim : theme.faint}>
                  {item.description}
                </text>
              </box>
              {/* A disabled row has nothing to quick-pick, so it shows no number. */}
              <text fg={selected && !dim ? theme.walnut : theme.faint}>
                {dim ? " " : String(i + 1)}
              </text>
            </box>
          </Fragment>
        );
      })}
    </box>
  );
}
