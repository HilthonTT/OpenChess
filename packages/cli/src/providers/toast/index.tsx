import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import type { ReactNode } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { SplitBorderChars } from "../../components/border";
import { useTheme } from "../theme";
import { DEFAULT_DURATION, DEFAULT_VARIANT } from "./types";
import type { ToastOptions, ToastVariant } from "./types";

export { DEFAULT_DURATION, DEFAULT_VARIANT } from "./types";
export type { ToastOptions, ToastVariant } from "./types";

const TOAST_MAX_WIDTH = 60;

const TOAST_HORIZONTAL_MARGIN = 6;

const TOAST_OFFSET = 2;
const TOAST_TEXT_COLOR = "#E1E1E1";

export type ToastContextValue = {
  show: (options: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return value;
}

type ToastProviderProps = {
  children: ReactNode;
};

export function ToastProvider({ children }: ToastProviderProps) {
  const [currentToast, setCurrentToast] = useState<ToastOptions | null>(null);
  const queueRef = useRef<ToastOptions[]>([]);
  const timeoutHandleRef = useRef<NodeJS.Timeout | null>(null);
  const showNextRef = useRef<() => void>(() => {});

  const clearCurrentTimeout = useCallback(() => {
    if (timeoutHandleRef.current) {
      clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }
  }, []);

  const showNext = useCallback(() => {
    timeoutHandleRef.current = null;

    const next = queueRef.current.shift() ?? null;
    setCurrentToast(next);

    if (next) {
      timeoutHandleRef.current = setTimeout(
        () => showNextRef.current(),
        next.duration ?? DEFAULT_DURATION,
      ).unref();
    }
  }, []);
  showNextRef.current = showNext;

  const show = useCallback(
    (options: ToastOptions) => {
      queueRef.current.push({
        ...options,
        variant: options.variant ?? DEFAULT_VARIANT,
        duration: options.duration ?? DEFAULT_DURATION,
      });

      if (!timeoutHandleRef.current) {
        showNext();
      }
    },
    [showNext],
  );

  useEffect(() => clearCurrentTimeout, [clearCurrentTimeout]);

  const value = useMemo<ToastContextValue>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toast currentToast={currentToast} />
    </ToastContext.Provider>
  );
}

type ToastProps = {
  currentToast: ToastOptions | null;
};

function Toast({ currentToast }: ToastProps) {
  const { colors } = useTheme();
  const { width } = useTerminalDimensions();

  if (!currentToast) {
    return null;
  }

  const variantColors: Record<ToastVariant, string> = {
    success: colors.success,
    error: colors.error,
    info: colors.info,
  };

  const borderColor = variantColors[currentToast.variant ?? DEFAULT_VARIANT];

  return (
    <box
      position="absolute"
      justifyContent="center"
      alignItems="flex-start"
      top={TOAST_OFFSET}
      right={TOAST_OFFSET}
      width={Math.max(
        1,
        Math.min(TOAST_MAX_WIDTH, width - TOAST_HORIZONTAL_MARGIN),
      )}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={colors.surface}
      borderColor={borderColor}
      border={["left", "right"]}
      customBorderChars={SplitBorderChars}
    >
      <box flexDirection="column" gap={1} width="100%">
        <text fg={TOAST_TEXT_COLOR} wrapMode="word" width="100%">
          {currentToast.message}
        </text>
      </box>
    </box>
  );
}
