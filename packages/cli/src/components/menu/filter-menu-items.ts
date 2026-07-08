import { MENU_ITEMS } from "./menu-items";
import type { MenuItem } from "./types";

export function getFilteredMenuItems(query: string): MenuItem[] {
  if (query.length === 0) {
    return MENU_ITEMS;
  }
  return MENU_ITEMS.filter((m) =>
    m.title.toLowerCase().startsWith(query.toLowerCase()),
  );
}
