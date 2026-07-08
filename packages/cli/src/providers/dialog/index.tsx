import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { DialogConfig } from "./types";
import { useKeyboardLayer } from "../keyboard-layer";
import { useTheme } from "../theme";
import { RGBA, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";

/** Id of the keyboard layer the dialog registers while open. */
const DIALOG_LAYER_ID = "dialog";
/** Semi-transparent black backdrop behind the dialog. */
const OVERLAY_BACKGROUND = RGBA.fromInts(0, 0, 0, 150);
const OVERLAY_Z_INDEX = 100;
const DIALOG_MAX_WIDTH = 60;
/** Horizontal space kept free between the dialog and the terminal edges. */
const DIALOG_HORIZONTAL_MARGIN = 4;

export type DialogContextValue = {
  open: (config: DialogConfig) => void;
  close: () => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

type Props = {
  children: ReactNode;
};

export function DialogProvider({ children }: Props) {
  const [dialogStack, setDialogStack] = useState<DialogConfig[]>([]);
  const { push, pop } = useKeyboardLayer();

  /** Opens a dialog on top of any already-open ones. */
  const open = useCallback((config: DialogConfig) => {
    setDialogStack((prev) => [...prev, config]);
  }, []);

  /** Closes the topmost dialog, revealing the one beneath it, if any. */
  const close = useCallback(() => {
    setDialogStack((prev) => prev.slice(0, -1));
  }, []);

  // Hold the keyboard layer while any dialog is open; ctrl+c closes the top one.
  const hasOpenDialog = dialogStack.length > 0;
  useEffect(() => {
    if (!hasOpenDialog) {
      return;
    }

    push(DIALOG_LAYER_ID, () => {
      close();
      return true;
    });
    return () => pop(DIALOG_LAYER_ID);
  }, [hasOpenDialog, push, pop, close]);

  const value = useMemo<DialogContextValue>(
    () => ({ open, close }),
    [open, close],
  );

  return (
    <DialogContext.Provider value={value}>
      {children}
      <Dialog currentDialog={dialogStack.at(-1) ?? null} close={close} />
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);
  if (!value) {
    throw new Error("useDialog must be used within a DialogProvider");
  }
  return value;
}

type DialogProps = {
  currentDialog: DialogConfig | null;
  close: () => void;
};

function Dialog({ currentDialog, close }: DialogProps) {
  const { isTopLayer } = useKeyboardLayer();
  const dimensions = useTerminalDimensions();
  const { colors } = useTheme();

  useKeyboard((key) => {
    if (!currentDialog || !isTopLayer(DIALOG_LAYER_ID)) {
      return;
    }

    if (key.name === "escape") {
      close();
    }
  });

  if (!currentDialog) {
    return null;
  }

  const { title, children } = currentDialog;

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions.width}
      height={dimensions.height}
      justifyContent="center"
      alignItems="center"
      backgroundColor={OVERLAY_BACKGROUND}
      zIndex={OVERLAY_Z_INDEX}
      onMouseDown={close}
    >
      <box
        width={Math.min(
          DIALOG_MAX_WIDTH,
          dimensions.width - DIALOG_HORIZONTAL_MARGIN,
        )}
        height="auto"
        backgroundColor={colors.dialogSurface}
        paddingX={4}
        paddingY={1}
        flexDirection="column"
        gap={1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <box
          paddingBottom={1}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <text attributes={TextAttributes.BOLD}>{title}</text>
          <text attributes={TextAttributes.DIM} onMouseDown={close}>
            esc
          </text>
        </box>
        <box flexGrow={1}>{children}</box>
      </box>
    </box>
  );
}
