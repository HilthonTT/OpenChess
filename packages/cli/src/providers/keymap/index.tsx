import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useKeyboard } from "@opentui/react";
import { HelpDialogContent } from "../../components/dialogs/help-dialog";
import { useDialog } from "../dialog";
import { BASE_LAYER_ID, useKeyboardLayer } from "../keyboard-layer";
import { isHelpKey } from "./key";
import type { Keymap } from "./types";

export type { KeyHelp, Keymap, KeymapSection } from "./types";
export { isHelpKey } from "./key";

type KeymapContextValue = {
  /** Record what `?` describes for one registration, or drop it with `null`. */
  set: (id: number, keymap: Keymap | null) => void;
  /** The registration in charge right now, read at keypress. */
  active: () => Keymap | null;
};

const KeymapContext = createContext<KeymapContextValue | null>(null);

/**
 * Handed out in render order, which runs parents before children. That gives
 * the ordering the registry needs and nothing else: it is never rendered.
 */
let nextRegistrationId = 0;

/** Shown for a screen with nothing of its own — the appended section is all. */
const NO_KEYS: Keymap = { title: "Keys", sections: [] };

export function KeymapProvider({ children }: { children: ReactNode }) {
  const dialog = useDialog();
  const { isTopLayer } = useKeyboardLayer();

  // A ref rather than state: nothing on screen depends on which keymap is
  // registered until `?` is actually pressed, so registering one must not
  // cost a render — and a screen that builds its keymap inline then cannot
  // loop by re-registering a fresh object every time it draws.
  const registry = useRef<Map<number, Keymap>>(new Map());

  const set = useCallback((id: number, keymap: Keymap | null) => {
    if (keymap) {
      registry.current.set(id, keymap);
    } else {
      registry.current.delete(id);
    }
  }, []);

  // Ids climb with render depth, so the innermost screen that registered one
  // is the one describing the keys the player can actually press. A parent
  // that has handed its screen to a child keeps its own registration only if
  // its keys still work — otherwise it registers `null`, exactly as its
  // keyboard handler already bails.
  const active = useCallback((): Keymap | null => {
    let best: Keymap | null = null;
    let bestId = -1;

    for (const [id, keymap] of registry.current) {
      if (id > bestId) {
        bestId = id;
        best = keymap;
      }
    }

    return best;
  }, []);

  useKeyboard((key) => {
    // The overlay belongs to the screen underneath it; a dialog of any kind
    // owns its own keys, the open overlay included.
    if (!isTopLayer(BASE_LAYER_ID) || !isHelpKey(key)) {
      return;
    }

    // Every screen's footer offers `?`, so every screen has to answer it. A
    // loading or error state that registered nothing genuinely has no keys of
    // its own, and the overlay says exactly that rather than doing nothing and
    // making the footer a lie.
    const keymap = active() ?? NO_KEYS;

    // Global handlers run ahead of the focused renderable, which is what keeps
    // the `?` out of the text field on the screens that have one.
    key.preventDefault();

    dialog.open({
      title: keymap.title,
      children: <HelpDialogContent keymap={keymap} />,
    });
  });

  const value = useMemo<KeymapContextValue>(
    () => ({ set, active }),
    [set, active],
  );

  return (
    <KeymapContext.Provider value={value}>{children}</KeymapContext.Provider>
  );
}

/**
 * Declare the keys this screen answers to, for the `?` overlay.
 *
 * Pass `null` while the screen's keyboard handler is standing down — a screen
 * that has handed itself to a child form is the usual reason. That is the same
 * condition the handler already tests, so the two cannot drift apart.
 */
export function useKeymap(keymap: Keymap | null): void {
  const context = useContext(KeymapContext);
  if (!context) {
    throw new Error("useKeymap must be used within a KeymapProvider");
  }

  const { set } = context;
  // Claimed during render, so a child's id is always above its parent's.
  const [id] = useState(() => nextRegistrationId++);

  useEffect(() => {
    set(id, keymap);
  }, [set, id, keymap]);

  // Kept apart from the write above so it fires on unmount alone, rather than
  // clearing the registration every time the keymap itself changes.
  useEffect(() => () => set(id, null), [set, id]);
}
