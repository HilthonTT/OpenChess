import type { ReactNode } from "react";
import type { Theme } from "../theme";
import { ThemeProvider } from "./theme";
import { KeyboardLayerProvider } from "./keyboard-layer";
import { DialogProvider } from "./dialog";
import { ToastProvider } from "./toast";
import { AuthProvider } from "./auth";

type Props = {
  children: ReactNode;
  /** Passed down from `--theme`; undefined keeps the saved preference. */
  initialTheme?: Theme;
};

export function AppProviders({ children, initialTheme }: Props) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <KeyboardLayerProvider>
        <DialogProvider>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </DialogProvider>
      </KeyboardLayerProvider>
    </ThemeProvider>
  );
}
