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
  /** Passed down from `--theme`; undefined keeps the saved preference. */
  initialTheme?: Theme;
  /** Passed down from `--pieces`; undefined keeps the saved preference. */
  initialPieceSet?: PieceSet;
};

export function AppProviders({
  children,
  initialTheme,
  initialPieceSet,
}: Props) {
  return (
    <ThemeProvider initialTheme={initialTheme}>
      {/* Above the dialog provider, since the piece-set picker is a dialog and
          the board behind it repaints as the highlight moves. */}
      <PieceSetProvider initialPieceSet={initialPieceSet}>
        <KeyboardLayerProvider>
          <DialogProvider>
            {/* Inside the dialog provider, since `?` opens one. */}
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
