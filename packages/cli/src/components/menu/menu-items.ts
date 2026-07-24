import {
  fetchPremiumStatus,
  openBillingPortal,
  openUpgradeCheckout,
} from "../../lib/upgrade";
import { errorMessage } from "../../lib/utils";
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
    id: "puzzles",
    title: "Puzzles",
    icon: "◈",
    description: "Train tactics, one position at a time",
    action(ctx) {
      ctx.navigate("/puzzles");
    },
  },
  {
    id: "challenges",
    title: "Challenges",
    icon: "⚔",
    description: "Challenge a friend, or take one on",
    action(ctx) {
      ctx.navigate("/challenges");
    },
  },
  {
    id: "watch",
    title: "Watch",
    icon: "◉",
    description: "Look in on a game in progress",
    action(ctx) {
      ctx.navigate("/watch");
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
  {
    id: "achievements",
    title: "Achievements",
    icon: "★",
    description: "Trophies you have earned",
    action(ctx) {
      ctx.navigate("/achievements");
    },
  },
  {
    id: "stats",
    title: "Stats",
    icon: "♖",
    description: "Your record, rating and streaks",
    action(ctx) {
      ctx.navigate("/stats");
    },
  },
  {
    id: "analysis",
    title: "Analysis",
    icon: "⌕",
    description: "Review a finished game with the engine",
    action(ctx) {
      ctx.navigate("/analysis");
    },
  },
  {
    id: "store",
    title: "Store",
    icon: "¤",
    description: "Spend coins on titles",
    action(ctx) {
      ctx.navigate("/store");
    },
  },
  {
    id: "upgrade",
    title: "Go Premium",
    icon: "♕",
    description: "Subscribe, or manage your plan",
    async action(ctx) {
      // Checkout is tied to the account, so there is nothing to buy for
      // a visitor the server doesn't know yet.
      if (ctx.auth.status !== "signed-in") {
        ctx.toast.show({
          message: "Sign in first to go premium.",
          variant: "info",
        });
        return;
      }

      try {
        // A subscriber gets the portal (cancel, invoices, card), not a
        // second checkout for a product they already pay for.
        if (await fetchPremiumStatus()) {
          await openBillingPortal();
          ctx.toast.show({
            message: "Billing portal opened in your browser.",
            variant: "success",
          });
        } else {
          await openUpgradeCheckout();
          ctx.toast.show({
            message: "Checkout opened in your browser.",
            variant: "success",
          });
        }
      } catch (error) {
        ctx.toast.show({
          message: `Couldn't open billing: ${errorMessage(error)}`,
          variant: "error",
        });
      }
    },
  },
];

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
