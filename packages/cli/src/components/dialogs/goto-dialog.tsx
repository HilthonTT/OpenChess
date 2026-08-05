import { useCallback, useMemo } from "react";
import { useTerminalDimensions } from "@opentui/react";
import type { AuthStatus } from "../../providers/auth";
import { useUITheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { createAuthMenuItem, MENU_ITEMS } from "../menu/menu-items";
import type { MenuItem, MenuItemContext } from "../menu/types";
import { TEXT_PRESENTATION } from "../pieces";
import { ThemeDialogContent } from "./theme-dialog";

/** Width of the title column, sized to the longest of them plus a gap. */
const TITLE_WIDTH = 14;

/** Columns the icon and the spaces either side of it take. */
const ICON_WIDTH = 3;

/** The scrollbox draws a bar down the right of every row it holds. */
const SCROLLBAR_WIDTH = 1;

/**
 * What the dialog provider reserves, less its padding — the same measurement
 * the help overlay makes, and for the same reason: the dialog's width is not
 * something its contents are told, so a column that has to fit has to work it
 * out. Kept here rather than shared, so neither dialog can quietly resize the
 * other by editing a constant.
 */
const DIALOG_MAX_WIDTH = 60;
const DIALOG_PADDING = 8;

/** Never squeeze the description to the point where it is all ellipsis. */
const MIN_DESCRIPTION_WIDTH = 8;

/** Trim a description to the room left for it, rather than let it be cut. */
function fit(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

/**
 * The rows that are not on the menu, because they are not screens: the way
 * back to the menu itself, and the two session keys the menu only offers while
 * you are standing on it.
 */
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
    id: "goto-quit",
    icon: "⏻",
    title: "Quit",
    description: "Leave OpenChess",
    action(ctx) {
      ctx.exit();
    },
  },
];

/**
 * Jump to any screen by typing its name, from wherever you are.
 *
 * There are more screens than there are number keys, and reaching the ones past
 * the ninth meant escaping to the menu and walking the cursor down it. The rows
 * are the menu's own `MENU_ITEMS`, run through the same `action` the menu runs,
 * so the two can never disagree about what a row opens — this is a second way
 * to press the same rows, not a second copy of the list.
 *
 * The context is handed in rather than read from hooks: the dialog is rendered
 * by the dialog provider, which sits *above* the toast and auth providers, so
 * nothing rendered inside a dialog can reach either of them. `GlobalKeys` can,
 * and it is what opens this.
 */
export function GoToDialogContent({
  ctx,
  authStatus,
}: {
  ctx: MenuItemContext;
  /** Read at open time, to draw the account row the way the menu draws it. */
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

      // Closed first, so an action that opens a dialog of its own — the theme
      // picker — replaces the palette rather than stacking on top of it.
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
      // The selected row is drawn on the theme's selection color, which is a
      // light one — hence black across it, the same as the other two dialogs.
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
