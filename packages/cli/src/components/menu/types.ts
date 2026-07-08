import type { DialogContextValue } from "../../providers/dialog";
import type { ToastContextValue } from "../../providers/toast";

export type MenuItemContext = {
  exit: () => void;
  toast: ToastContextValue;
  dialog: DialogContextValue;
};

export type MenuItem = {
  id: string;
  icon: string;
  title: string;
  description: string;
  action?: (ctx: MenuItemContext) => void | Promise<void>;
};
