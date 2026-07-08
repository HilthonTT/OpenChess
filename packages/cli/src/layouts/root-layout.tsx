import { Outlet } from "react-router";
import { AppProviders } from "../providers";
import { ThemeRoot } from "./themed-root";

export function RootLayout() {
  return (
    <AppProviders>
      <ThemeRoot>
        <Outlet />
      </ThemeRoot>
    </AppProviders>
  );
}
