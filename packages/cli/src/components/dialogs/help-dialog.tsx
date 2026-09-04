import { useRef, type ReactNode } from "react";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useDialog } from "../../providers/dialog";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { isHelpKey } from "../../providers/keymap/key";
import type { Keymap, KeymapSection } from "../../providers/keymap/types";
import { useUITheme } from "../../providers/theme";

const DIALOG_LAYER_ID = "dialog";

const KEY_WIDTH = 15;

const FRAME_LINES = 8;

const MIN_VISIBLE_LINES = 6;

const DIALOG_MAX_WIDTH = 60;
const DIALOG_PADDING = 8;

const MIN_LABEL_WIDTH = 12;

export function HelpDialogContent({ keymap }: { keymap: Keymap }) {
  const theme = useUITheme();
  const dialog = useDialog();
  const { isTopLayer } = useKeyboardLayer();
  const dimensions = useTerminalDimensions();
  const scrollRef = useRef<ScrollBoxRenderable>(null);

  const contentWidth =
    Math.min(DIALOG_MAX_WIDTH, dimensions.width - 4) - DIALOG_PADDING;
  const labelWidth = Math.max(MIN_LABEL_WIDTH, contentWidth - KEY_WIDTH);

  const lines = layout(sectionsWithUniversal(keymap), theme, labelWidth);
  const visible = Math.max(
    MIN_VISIBLE_LINES,
    Math.min(lines.length, dimensions.height - FRAME_LINES),
  );
  const maxScroll = Math.max(0, lines.length - visible);

  useKeyboard((key) => {
    if (!isTopLayer(DIALOG_LAYER_ID)) {
      return;
    }

    if (isHelpKey(key)) {
      dialog.close();
      return;
    }

    const scrollbox = scrollRef.current;
    if (!scrollbox || maxScroll === 0) {
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        scrollbox.scrollTo(Math.max(0, scrollbox.scrollTop - 1));
        break;
      case "down":
      case "j":
        scrollbox.scrollTo(Math.min(maxScroll, scrollbox.scrollTop + 1));
        break;
      case "home":
        scrollbox.scrollTo(0);
        break;
      case "end":
        scrollbox.scrollTo(maxScroll);
        break;
    }
  });

  return (
    <box flexDirection="column">
      <scrollbox ref={scrollRef} height={visible}>
        {lines.map((line) => (
          <box key={line.key} height={1} overflow="hidden">
            {line.node}
          </box>
        ))}
      </scrollbox>
      {maxScroll > 0 ? (
        <text fg={theme.faint}>{`  ↑↓ ${lines.length - visible} more`}</text>
      ) : null}
    </box>
  );
}

type Line = { key: string; node: ReactNode };

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(" ")) {
    if (line === "") {
      line = word;
    } else if (line.length + 1 + word.length <= width) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }

    while (line.length > width) {
      lines.push(line.slice(0, width));
      line = line.slice(width);
    }
  }

  if (line !== "") {
    lines.push(line);
  }

  return lines.length === 0 ? [""] : lines;
}

function layout(
  sections: KeymapSection[],
  theme: ReturnType<typeof useUITheme>,
  labelWidth: number,
): Line[] {
  const lines: Line[] = [];

  sections.forEach((section, index) => {
    if (index > 0) {
      lines.push({ key: `gap-${index}`, node: <text> </text> });
    }

    if (section.title) {
      wrap(section.title, KEY_WIDTH + labelWidth).forEach((part, row) => {
        lines.push({
          key: `title-${index}-${row}`,
          node: <text fg={theme.gold}>{part}</text>,
        });
      });
    }

    for (const help of section.keys) {
      wrap(help.label, labelWidth).forEach((part, row) => {
        lines.push({
          key: `key-${index}-${help.keys}-${help.label}-${row}`,
          node: (
            <text>
              <span fg={theme.cream}>
                {(row === 0 ? help.keys : "").padEnd(KEY_WIDTH)}
              </span>
              <span fg={theme.dim}>{part}</span>
            </text>
          ),
        });
      });
    }
  });

  return lines;
}

function sectionsWithUniversal(keymap: Keymap): KeymapSection[] {
  const keys = [
    { keys: "?", label: "this list" },
    { keys: "ctrl+k", label: "jump to any screen by name" },
  ];

  if (keymap.escape !== null) {
    keys.push({ keys: "esc", label: keymap.escape ?? "back to the menu" });
  }

  keys.push({ keys: "ctrl+c", label: "quit" });

  return [...keymap.sections, { title: "Anywhere", keys }];
}
