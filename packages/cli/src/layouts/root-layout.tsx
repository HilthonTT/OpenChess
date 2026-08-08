import { Outlet } from "react-router";
import type { Theme } from "../theme";
import type { PieceSet } from "../components/pieces";
import { GlobalKeys } from "../components/global-keys";
import { AppProviders } from "../providers";
import { ThemeRoot } from "./themed-root";

type RootLayoutProps = {
  /** Passed down from `--theme`; undefined keeps the saved preference. */
  initialTheme?: Theme;
  /** Passed down from `--pieces`; undefined keeps the saved preference. */
  initialPieceSet?: PieceSet;
};

export function RootLayout({
  initialTheme,
  initialPieceSet,
}: RootLayoutProps = {}) {
  return (
    <AppProviders initialTheme={initialTheme} initialPieceSet={initialPieceSet}>
      <ThemeRoot>
        <GlobalKeys />
        <Outlet />
      </ThemeRoot>
    </AppProviders>
  );
}
