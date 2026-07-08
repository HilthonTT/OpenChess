import type { MenuItem } from "./types";

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "local",
    title: "Local 1v1",
    icon: "♟",
    description: "Two players sharing one keyboard",
    action(ctx) {
      ctx.toast.show({ message: "Starting local 1v1..." });
    },
  },
  {
    id: "online",
    title: "Online 1v1",
    icon: "♞",
    description: "Challenge a player over the network",
    action(ctx) {
      ctx.toast.show({ message: "Starting online 1v1..." });
    },
  },
  {
    id: "ai",
    title: "Play vs AI",
    icon: "♛",
    description: "Test your skill against the engine",
    action(ctx) {
      ctx.toast.show({ message: "Starting ai 1v1..." });
    },
  },
];
