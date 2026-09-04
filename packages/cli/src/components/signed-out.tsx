import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useKeymap, type KeyHelp, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import { HintBar, type Hint } from "./hint-bar";

const SIGN_IN_KEY: KeyHelp = {
  keys: "enter",
  label: "sign in, without leaving",
};

export function SignedOut({
  title,
  message,
  note,
  extraKeys = [],
  extraHints = [],
}: {
  title: string;
  message: string;
  note?: string;
  extraKeys?: KeyHelp[];
  extraHints?: Hint[];
}) {
  const auth = useAuth();
  const theme = useUITheme();
  const toast = useToast();
  const { isTopLayer } = useKeyboardLayer();

  const keymap: Keymap = {
    title: "Signed out",
    sections: [{ keys: [SIGN_IN_KEY, ...extraKeys] }],
  };

  useKeymap(keymap);

  const signIn = useCallback(async () => {
    try {
      const profile = await auth.signIn();
      toast.show({
        message: profile ? `Signed in as ${profile.username}.` : "Signed in.",
        variant: "success",
      });
    } catch (error) {
      toast.show({
        message: `Sign in failed: ${errorMessage(error)}`,
        variant: "error",
      });
    }
  }, [auth, toast]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || auth.status !== "signed-out") {
      return;
    }

    if (key.name === "return") {
      void signIn();
    }
  });

  if (auth.status === "checking") {
    return <text fg={theme.dim}>Checking your session…</text>;
  }

  if (auth.status === "signing-in") {
    return (
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.gold}>Waiting for your browser…</text>
        <text fg={theme.dim}>Finish in the tab we opened.</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <text fg={theme.gold}>{title}</text>
      <text fg={theme.dim} wrapMode="word">
        {message}
      </text>
      {note ? (
        <text fg={theme.dim} wrapMode="word">
          {note}
        </text>
      ) : null}
      <HintBar hints={[{ key: "enter", label: "sign in" }, ...extraHints]} />
    </box>
  );
}
