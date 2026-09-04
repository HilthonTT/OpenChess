import { useMemo } from "react";
import { useKeyboard, useRenderer } from "@opentui/react";
import { useNavigate } from "react-router";
import { GoToDialogContent } from "./dialogs/goto-dialog";
import type { MenuItemContext } from "./menu/types";
import { useAuth } from "../providers/auth";
import { useDialog } from "../providers/dialog";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useToast } from "../providers/toast";

const GOTO_KEY = "k";

export function GlobalKeys() {
  const dialog = useDialog();
  const toast = useToast();
  const auth = useAuth();
  const navigate = useNavigate();
  const renderer = useRenderer();
  const { isTopLayer } = useKeyboardLayer();

  const context = useMemo<MenuItemContext>(
    () => ({
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
    if (!isTopLayer(BASE_LAYER_ID) || !key.ctrl || key.name !== GOTO_KEY) {
      return;
    }

    key.preventDefault();

    dialog.open({
      title: "Go to",
      children: <GoToDialogContent ctx={context} authStatus={auth.status} />,
    });
  });

  return null;
}
