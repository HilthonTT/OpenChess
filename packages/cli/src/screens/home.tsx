import { useCallback, useMemo } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useNavigate } from "react-router";
import { AuthStatus } from "../components/auth-status";
import { Header } from "../components/header";
import { HintBar } from "../components/hint-bar";
import { Menu, QUICK_PICK_LIMIT } from "../components/menu";
import { createAuthMenuItem, MENU_ITEMS } from "../components/menu/menu-items";
import type { MenuItem } from "../components/menu/types";
import { ThemeDialogContent } from "../components/dialogs/theme-dialog";
import { useDailyCheckIn } from "../hooks/use-daily-check-in";
import { useAuth } from "../providers/auth";
import { useToast } from "../providers/toast";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";

// Which row last sent the user away. Module state, not React state: the
// router unmounts Home while a screen is open, so this is what lets the
// cursor come back to the same row instead of the top.
let lastSelectedId: string | undefined;

const KEYMAP: Keymap = {
  title: "The menu",
  // The one screen with nowhere to go back to.
  escape: null,
  sections: [
    {
      keys: [
        { keys: "↑↓ / jk", label: "move" },
        { keys: "enter", label: "open the highlighted screen" },
        { keys: "1-9", label: "open a screen by the number beside it" },
        { keys: "ctrl+k", label: "open one by name — including the rest" },
      ],
    },
    {
      title: "Session",
      keys: [
        { keys: "ctrl+.", label: "change the theme" },
        { keys: "ctrl+l", label: "sign in, or sign out" },
        { keys: "q", label: "quit" },
      ],
    },
  ],
};

export function Home() {
  const renderer = useRenderer();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const auth = useAuth();
  const { currentTheme } = useTheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(KEYMAP);

  // The menu is where a session first lands, whether the token was restored at
  // launch or signed in for from the row below, so it is where the day is
  // claimed. Silent unless there was actually something to claim.
  useDailyCheckIn();

  const authItem = useMemo(
    () => createAuthMenuItem(auth.status),
    [auth.status],
  );
  const items = useMemo(() => [...MENU_ITEMS, authItem], [authItem]);

  const handleSelect = useCallback(
    (menuItem: MenuItem) => {
      lastSelectedId = menuItem.id;
      void menuItem.action?.({
        exit: () => renderer.destroy(),
        navigate: (path) => void navigate(path),
        toast,
        dialog,
        auth,
      });
    },
    [renderer, navigate, toast, dialog, auth],
  );

  useKeyboard((key) => {
    // Only the base screen owns these shortcuts; while a dialog is open its
    // own layer handles input (e.g. typing "q" into the theme search).
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (key.name === "q") {
      renderer.destroy();
      process.exit(0);
    }

    if (key.ctrl && key.name === ".") {
      dialog.open({
        title: "Select Theme",
        children: <ThemeDialogContent />,
      });
    }

    // The same action the account row runs, so the shortcut and the row can
    // never disagree about whether this signs you in or out.
    if (key.ctrl && key.name === "l" && !authItem.disabled) {
      handleSelect(authItem);
    }
  });

  // Rows are numbered by position, but only the first nine can be reached by a
  // number key, so that — not the length of the list — is what the footer can
  // honestly advertise. Everything below the ninth row is what ctrl+k is for.
  const highestQuickPick = Math.min(
    QUICK_PICK_LIMIT,
    items.filter((item) => !item.disabled).length,
  );

  const accountLabel =
    auth.status === "signed-in"
      ? "sign out"
      : auth.status === "signed-out"
        ? "sign in"
        : "account";

  return (
    <box
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      flexGrow={1}
      gap={1}
      position="relative"
      width="100%"
      height="100%"
    >
      <box
        flexDirection="column"
        alignItems="center"
        rowGap={0.5}
        marginBottom={0.5}
      >
        <Header />
        <AuthStatus />
      </box>

      <Menu
        items={items}
        onSelect={handleSelect}
        initialSelectedId={lastSelectedId}
      />

      <box flexDirection="column" alignItems="center">
        <HintBar
          hints={[
            { key: "↑↓", label: "move" },
            { key: "enter", label: "select" },
            { key: `1-${highestQuickPick}`, label: "quick pick" },
            // Sits beside the numbers on purpose: it is where the rows past
            // the ninth went.
            { key: "ctrl+k", label: "jump" },
            { key: "?", label: "keys" },
          ]}
        />
        <HintBar
          hints={[
            { key: "ctrl+.", label: "theme", value: currentTheme.name },
            { key: "ctrl+l", label: accountLabel },
            { key: "q", label: "quit" },
          ]}
        />
      </box>
    </box>
  );
}
