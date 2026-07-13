import type { AuthContextValue } from "../../providers/auth";
import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";

export type MenuItemContext = {
  exit: () => void;
  navigate: (path: string) => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
  auth: AuthContextValue;
};

export type MenuItem = {
  id: string;
  icon: string;
  title: string;
  description: string;
  action?: (ctx: MenuItemContext) => void | Promise<void>;
  url?: string;
  /** Listed, but not selectable — e.g. the account row while a sign-in is in flight. */
  disabled?: boolean;
  /** Draws a rule above the row, setting it apart from the group above it. */
  dividerBefore?: boolean;
};
