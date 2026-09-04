import type { ReactNode } from "react";
import type { Theme } from "../theme";
import type { PieceSet } from "../components/pieces";
import { ThemeProvider } from "./theme";
import { PieceSetProvider } from "./pieces";
import { KeyboardLayerProvider } from "./keyboard-layer";
import { DialogProvider } from "./dialog";
import { KeymapProvider } from "./keymap";
import { ToastProvider } from "./toast";
import { AuthProvider } from "./auth";

type Props = {
  children: ReactNode;
  initialTheme?: Theme;
  initialPieceSet?: PieceSet;
};

export function AppProviders({
  children,
  initialTheme,
  initialPieceSet,
}: Props) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      <PieceSetProvider initialPieceSet={initialPieceSet}>
        <KeyboardLayerProvider>
          <DialogProvider>
            <KeymapProvider>
              <ToastProvider>
                <AuthProvider>{children}</AuthProvider>
              </ToastProvider>
            </KeymapProvider>
          </DialogProvider>
        </KeyboardLayerProvider>
      </PieceSetProvider>
    </ThemeProvider>
  );
}
