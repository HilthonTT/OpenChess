import { useCallback } from "react";
import { useKeyboard } from "@opentui/react";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useKeymap, type KeyHelp, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import { HintBar, type Hint } from "./hint-bar";

/** The one key the notice itself answers to. */
const SIGN_IN_KEY: KeyHelp = {
  keys: "enter",
  label: "sign in, without leaving",
};

/**
 * What a screen shows instead of its contents when there is no account behind
 * it — and the way back in.
 *
 * Every one of these screens used to say "sign in from the home screen, then
 * come back", which is four steps to reach the thing the player was already
 * looking at. `signIn` is on the auth context here exactly as it is on the
 * menu, so the notice runs it in place and the screen fills in behind it.
 *
 * The two states either side of signed-out are drawn here too: the session
 * check at launch, and the wait while the browser tab is open. They were the
 * same three states on all twelve screens, so they are written once.
 */
export function SignedOut({
  title,
  message,
  note,
  extraKeys = [],
  extraHints = [],
}: {
  /** The headline, e.g. "Friends need an account". */
  title: string;
  /** Why this particular screen wants one. */
  message: string;
  /** A second line, for a screen with something that works signed out anyway. */
  note?: string;
  /** That something, for the `?` overlay — the screen still handles the key. */
  extraKeys?: KeyHelp[];
  /** And for the footer beside `enter sign in`. */
  extraHints?: Hint[];
}) {
  const auth = useAuth();
  const theme = useUITheme();
  const toast = useToast();
  const { isTopLayer } = useKeyboardLayer();

  // Registered from here rather than from each screen: while this is up, the
  // screen's own keys do nothing, so describing them under `?` would be a lie.
  // Built inline, which the registry is written to allow — it costs a map
  // write per render and nothing else.
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
    // Only while the notice is the thing on screen: a dialog over it owns its
    // own enter, and a second press during the browser round trip would open a
    // second tab.
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
