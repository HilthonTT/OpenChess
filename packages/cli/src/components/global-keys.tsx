import { useMemo } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useNavigate } from "react-router";
import { GoToDialogContent } from "./dialogs/goto-dialog";
import type { MenuItemContext } from "./menu/types";
import { useAuth } from "../providers/auth";
import { useDialog } from "../providers/dialog";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useToast } from "../providers/toast";

/** The key that opens the palette, wherever you are. */
const GOTO_KEY = "k";

/**
 * The keys that belong to the app rather than to any one screen.
 *
 * Mounted beside the router's outlet, so it survives every navigation: a
 * screen cannot forget to offer these, and cannot take them for itself either.
 * `?` is handled the same way, one layer up in the keymap provider.
 *
 * It is also the lowest place in the tree that can see every provider, which
 * matters: a dialog's contents are rendered by the dialog provider, above the
 * toast and auth ones, so the palette is handed the context it needs from here
 * rather than reading it where it is drawn.
 */
export function GlobalKeys() {
  const dialog = useDialog();
  const toast = useToast();
  const auth = useAuth();
  const navigate = useNavigate();
  const renderer = useRenderer();
  const { isTopLayer } = useKeyboardLayer();

  const context = useMemo<MenuItemContext>(
    () => ({
      // The same pair the menu's own quit runs: destroy() alone leaves the
      // process up, since the live pollers keep Bun alive.
      exit: () => {
        renderer.destroy();
        process.exit(0);
      },
      navigate: (path) => void navigate(path),
      toast,
      dialog,
      auth,
    }),
    [renderer, navigate, toast, dialog, auth],
  );

  useKeyboard((key) => {
    // Not while a dialog is up: it owns the keyboard, and the palette opening
    // over the theme picker would bury the picker rather than replace it.
    if (!isTopLayer(BASE_LAYER_ID) || !key.ctrl || key.name !== GOTO_KEY) {
      return;
    }

    // Screens with a text field are focused on it; the global handler runs
    // first, but the field would still swallow the keystroke afterwards.
    key.preventDefault();

    dialog.open({
      title: "Go to",
      children: <GoToDialogContent ctx={context} authStatus={auth.status} />,
    });
  });

  return null;
}
