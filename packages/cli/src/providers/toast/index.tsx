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

export type ToastVariant = "success" | "error" | "info";

export type ToastOptions = {
  message: string;
  variant?: ToastVariant;
  duration?: number;
};

/** How long a toast stays visible, in milliseconds. */
export const DEFAULT_DURATION = 3000;
export const DEFAULT_VARIANT: ToastVariant = "info";

const TOAST_MAX_WIDTH = 60;
/** Horizontal space kept free between the toast and the terminal edges. */
const TOAST_HORIZONTAL_MARGIN = 6;
/** Offset from the top-right corner of the terminal. */
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
  const timeoutHandleRef = useRef<NodeJS.Timeout | null>(null);

  const clearCurrentTimeout = useCallback(() => {
    if (timeoutHandleRef.current) {
      clearTimeout(timeoutHandleRef.current);
      timeoutHandleRef.current = null;
    }
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const duration = options.duration ?? DEFAULT_DURATION;

      clearCurrentTimeout();

      setCurrentToast({
        ...options,
        variant: options.variant ?? DEFAULT_VARIANT,
        duration,
      });

      timeoutHandleRef.current = setTimeout(() => {
        setCurrentToast(null);
      }, duration).unref();
    },
    [clearCurrentTimeout],
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
