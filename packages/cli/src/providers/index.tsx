import type { ReactNode } from "react";
import { ThemeProvider } from "./theme";
import { KeyboardLayerProvider } from "./keyboard-layer";
import { DialogProvider } from "./dialog";
import { ToastProvider } from "./toast";
import { AuthProvider } from "./auth";

type Props = {
  children: ReactNode;
};

export function AppProviders({ children }: Props) {
  return (
    <ThemeProvider>
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
