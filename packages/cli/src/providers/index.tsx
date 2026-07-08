import type { ReactNode } from "react";
import { ThemeProvider } from "./theme";
import { KeyboardLayerProvider } from "./keyboard-layer";
import { DialogProvider } from "./dialog";
import { ToastProvider } from "./toast";

type Props = {
  children: ReactNode;
};

export function AppProviders({ children }: Props) {
  return (
    <ThemeProvider>
      <KeyboardLayerProvider>
        <DialogProvider>
          <ToastProvider>{children}</ToastProvider>
        </DialogProvider>
      </KeyboardLayerProvider>
    </ThemeProvider>
  );
}
