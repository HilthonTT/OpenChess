import { Outlet } from "react-router";
import type { Theme } from "../theme";
import { AppProviders } from "../providers";
import { ThemeRoot } from "./themed-root";

type RootLayoutProps = {
  /** Passed down from `--theme`; undefined keeps the saved preference. */
  initialTheme?: Theme;
};

export function RootLayout({ initialTheme }: RootLayoutProps = {}) {
  return (
    <AppProviders initialTheme={initialTheme}>
      <ThemeRoot>
        <Outlet />
      </ThemeRoot>
    </AppProviders>
  );
}
