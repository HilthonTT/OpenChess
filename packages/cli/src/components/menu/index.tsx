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

/**
 * How many rows a number key can reach. There are only nine of them, and the
 * rows past that are what `ctrl+k` is for — numbering a row the keyboard has
 * no way to send you to is a promise the menu can't keep.
 */
export const QUICK_PICK_LIMIT = 9;

interface MenuProps {
  items: MenuItem[];
  onSelect: (item: MenuItem) => void;
  /** Row to start the cursor on, e.g. the one that sent the user away. */
  initialSelectedId?: string;
}

export function Menu({ items, onSelect, initialSelectedId }: MenuProps) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();
  const [index, setIndex] = useState(() => {
    const initial = items.findIndex((item) => item.id === initialSelectedId);
    return initial === -1 ? 0 : initial;
  });

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
      paddingLeft={2}
      paddingRight={2}
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
              backgroundColor={selected && !dim ? theme.selectionBg : undefined}
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
                <span fg={dim ? theme.dim : selected ? theme.cream : theme.dim}>
                  {selected && !dim ? <b>{item.title}</b> : item.title}
                </span>
              </text>
              <box flexGrow={1} />
              {/* A row only shows a number when that number actually opens it:
                  a disabled row has nothing to pick, and past the ninth there
                  is no key left to press. */}
              <text fg={selected && !dim ? theme.walnut : theme.faint}>
                {dim || i >= QUICK_PICK_LIMIT ? " " : String(i + 1)}
              </text>
            </box>
          </Fragment>
        );
      })}

      <box paddingLeft={1}>
        <text fg={theme.faint}>{items[index]?.description ?? ""}</text>
      </box>
    </box>
  );
}
