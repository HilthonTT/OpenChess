import { useCallback, useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { AuthStatus } from "../../providers/auth";
import { useUITheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { createAuthMenuItem, MENU_ITEMS } from "../menu/menu-items";
import type { MenuItem, MenuItemContext } from "../menu/types";
import { TEXT_PRESENTATION } from "../pieces";
import { PieceSetDialogContent } from "./piece-set-dialog";
import { ThemeDialogContent } from "./theme-dialog";

const TITLE_WIDTH = 14;

const ICON_WIDTH = 3;

const SCROLLBAR_WIDTH = 1;

const DIALOG_MAX_WIDTH = 60;
const DIALOG_PADDING = 8;

const MIN_DESCRIPTION_WIDTH = 8;

function fit(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

const GLOBAL_ITEMS: MenuItem[] = [
  {
    id: "goto-home",
    icon: "⌂",
    title: "Main menu",
    description: "Back to the list of everything",
    action(ctx) {
      ctx.navigate("/");
    },
  },
  {
    id: "goto-theme",
    icon: "◐",
    title: "Change theme",
    description: "Repaint the UI and the board",
    action(ctx) {
      ctx.dialog.open({
        title: "Select Theme",
        children: <ThemeDialogContent />,
      });
    },
  },
  {
    id: "goto-pieces",
    icon: "♟",
    title: "Piece set",
    description: "Figurines, or letters if they render wrong",
    action(ctx) {
      ctx.dialog.open({
        title: "Select Piece Set",
        children: <PieceSetDialogContent />,
      });
    },
  },
  {
    id: "goto-quit",
    icon: "⏻",
    title: "Quit",
    description: "Leave OpenChess",
    action(ctx) {
      ctx.exit();
    },
  },
];

export function GoToDialogContent({
  ctx,
  authStatus,
}: {
  ctx: MenuItemContext;
  authStatus: AuthStatus;
}) {
  const theme = useUITheme();
  const dimensions = useTerminalDimensions();

  const descriptionWidth = Math.max(
    MIN_DESCRIPTION_WIDTH,
    Math.min(DIALOG_MAX_WIDTH, dimensions.width - 4) -
      DIALOG_PADDING -
      SCROLLBAR_WIDTH -
      ICON_WIDTH -
      TITLE_WIDTH,
  );

  const items = useMemo(
    () => [...GLOBAL_ITEMS, ...MENU_ITEMS, createAuthMenuItem(authStatus)],
    [authStatus],
  );

  const handleSelect = useCallback(
    (item: MenuItem) => {
      if (item.disabled) {
        return;
      }

      ctx.dialog.close();
      void item.action?.(ctx);
    },
    [ctx],
  );

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) => {
        const needle = query.toLowerCase();
        return (
          item.title.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle)
        );
      }}
      renderItem={(item, isSelected) => (
        <text selectable={false}>
          <span fg={isSelected ? "black" : theme.walnut}>
            {` ${item.icon}${TEXT_PRESENTATION} `}
          </span>
          <span fg={isSelected ? "black" : theme.text}>
            {item.title.padEnd(TITLE_WIDTH)}
          </span>
          <span fg={isSelected ? "black" : theme.dim}>
            {fit(item.description, descriptionWidth)}
          </span>
        </text>
      )}
      getKey={(item) => item.id}
      placeholder="Type a screen name"
      emptyText="Nothing by that name"
    />
  );
}
