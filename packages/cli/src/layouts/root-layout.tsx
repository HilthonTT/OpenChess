import { Outlet } from "react-router";
import type { Theme } from "../theme";
import type { PieceSet } from "../components/pieces";
import { GlobalKeys } from "../components/global-keys";
import { AppProviders } from "../providers";
import { ThemeRoot } from "./themed-root";

type RootLayoutProps = {
  initialTheme?: Theme;
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
