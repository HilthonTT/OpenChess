import { useCallback, useMemo } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useNavigate } from "react-router";
import { AuthStatus } from "../components/auth-status";
import { Header } from "../components/header";
import { HintBar } from "../components/hint-bar";
import { Menu } from "../components/menu";
import { createAuthMenuItem, MENU_ITEMS } from "../components/menu/menu-items";
import type { MenuItem } from "../components/menu/types";
import { ThemeDialogContent } from "../components/dialogs/theme-dialog";
import { useAuth } from "../providers/auth";
import { useToast } from "../providers/toast";
import { useDialog } from "../providers/dialog";
import { useTheme } from "../providers/theme";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";

export function Home() {
  const renderer = useRenderer();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const auth = useAuth();
  const { currentTheme } = useTheme();
  const { isTopLayer } = useKeyboardLayer();

  const authItem = useMemo(
    () => createAuthMenuItem(auth.status),
    [auth.status],
  );
  const items = useMemo(() => [...MENU_ITEMS, authItem], [authItem]);

  const handleSelect = useCallback(
    (menuItem: MenuItem) => {
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

  // Rows are numbered by position and the account row is last, so the highest
  // number worth advertising is the count of selectable rows.
  const highestQuickPick = items.filter((item) => !item.disabled).length;

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
      gap={2}
      position="relative"
      width="100%"
      height="100%"
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        <Header />
        <AuthStatus />
      </box>

      <Menu items={items} onSelect={handleSelect} />

      <box flexDirection="column" alignItems="center" rowGap={1}>
        <HintBar
          hints={[
            { key: "↑↓", label: "move" },
            { key: "enter", label: "select" },
            { key: `1-${highestQuickPick}`, label: "quick pick" },
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
