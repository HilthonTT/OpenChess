import type { AuthStatus } from "../../providers/auth";
import type { MenuItem } from "./types";

export const MENU_ITEMS: MenuItem[] = [
  {
    id: "local",
    title: "Local 1v1",
    icon: "♟",
    description: "Two players sharing one keyboard",
    action(ctx) {
      ctx.navigate("/local");
    },
  },
  {
    id: "online",
    title: "Online 1v1",
    icon: "♞",
    description: "Challenge a player over the network",
    action(ctx) {
      ctx.navigate("/online");
    },
  },
  {
    id: "ai",
    title: "Play vs AI",
    icon: "♛",
    description: "Test your skill against the engine",
    action(ctx) {
      ctx.navigate("/ai");
    },
  },
  {
    id: "leaderboard",
    title: "Leaderboard",
    icon: "♔",
    description: "See where you rank",
    action(ctx) {
      ctx.navigate("/leaderboard");
    },
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The account row that closes the menu. It tracks the session, so what ENTER
 * will do is written on the row itself — the user never has to remember whether
 * they're signed in, or hunt for a separate screen to change it.
 *
 * Descriptions are kept under ~36 characters: the menu sizes itself to its
 * content, so one that wraps would make the whole box grow as the status
 * changes.
 */
export function createAuthMenuItem(status: AuthStatus): MenuItem {
  switch (status) {
    case "signed-in":
      return {
        id: "sign-out",
        icon: "⏻",
        title: "Sign out",
        description: "Forget the token on this machine",
        dividerBefore: true,
        action(ctx) {
          ctx.auth.signOut();
          ctx.toast.show({ message: "Signed out.", variant: "info" });
        },
      };

    case "signed-out":
      return {
        id: "sign-in",
        icon: "⏻",
        title: "Sign in",
        description: "Opens your browser to authorize",
        dividerBefore: true,
        async action(ctx) {
          try {
            const profile = await ctx.auth.signIn();

            ctx.toast.show({
              message: profile
                ? `Signed in as ${profile.username}.`
                : "Signed in.",
              variant: "success",
            });
          } catch (error) {
            ctx.toast.show({
              message: `Sign in failed: ${errorMessage(error)}`,
              variant: "error",
            });
          }
        },
      };

    case "checking":
      return {
        id: "auth-checking",
        icon: "◌",
        title: "Checking session…",
        description: "Verifying your saved token",
        disabled: true,
        dividerBefore: true,
      };

    case "signing-in":
      return {
        id: "auth-signing-in",
        icon: "◌",
        title: "Waiting for your browser…",
        description: "Finish in the tab we opened",
        disabled: true,
        dividerBefore: true,
      };
  }
}
