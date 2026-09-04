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
  set: (id: number, keymap: Keymap | null) => void;
  active: () => Keymap | null;
};

const KeymapContext = createContext<KeymapContextValue | null>(null);

let nextRegistrationId = 0;

const NO_KEYS: Keymap = { title: "Keys", sections: [] };

export function KeymapProvider({ children }: { children: ReactNode }) {
  const dialog = useDialog();
  const { isTopLayer } = useKeyboardLayer();

  const registry = useRef<Map<number, Keymap>>(new Map());

  const set = useCallback((id: number, keymap: Keymap | null) => {
    if (keymap) {
      registry.current.set(id, keymap);
    } else {
      registry.current.delete(id);
    }
  }, []);

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
    if (!isTopLayer(BASE_LAYER_ID) || !isHelpKey(key)) {
      return;
    }

    const keymap = active() ?? NO_KEYS;

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

export function useKeymap(keymap: Keymap | null): void {
  const context = useContext(KeymapContext);
  if (!context) {
    throw new Error("useKeymap must be used within a KeymapProvider");
  }

  const { set } = context;
  const [id] = useState(() => nextRegistrationId++);

  useEffect(() => {
    set(id, keymap);
  }, [set, id, keymap]);

  useEffect(() => () => set(id, null), [set, id]);
}
