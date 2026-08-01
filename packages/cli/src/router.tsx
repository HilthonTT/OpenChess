import type { ReactNode } from "react";
import { createMemoryRouter } from "react-router";
import type { LaunchOptions } from "./lib/cli-args";
import { SCREENS, type ScreenName } from "./lib/screens";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { LocalGame } from "./screens/local-game";
import { OnlineGame } from "./screens/online-game";
import { AIGame } from "./screens/ai-game";
import { Leaderboard } from "./screens/leaderboard";
import { Achievements } from "./screens/achievements";
import { Stats } from "./screens/stats";
import { Store } from "./screens/store";
import { Analysis } from "./screens/analysis";
import { Explorer } from "./screens/explorer";
import { Puzzles } from "./screens/puzzles";
import { Rush } from "./screens/rush";
import { Watch } from "./screens/watch";
import { Challenges } from "./screens/challenges";
import { Friends } from "./screens/friends";
import { Profile } from "./screens/profile";

/**
 * What each screen renders, keyed by the screen list rather than written out
 * as routes: a screen the command line advertises then always has something to
 * open, and one with no entry here cannot be routed to quietly.
 */
const SCREEN_ELEMENTS: Record<ScreenName, ReactNode> = {
  local: <LocalGame />,
  online: <OnlineGame />,
  ai: <AIGame />,
  puzzles: <Puzzles />,
  rush: <Rush />,
  challenges: <Challenges />,
  friends: <Friends />,
  watch: <Watch />,
  leaderboard: <Leaderboard />,
  achievements: <Achievements />,
  stats: <Stats />,
  analysis: <Analysis />,
  explorer: <Explorer />,
  store: <Store />,
  profile: <Profile />,
};

/**
 * The app, opened where the command line asked for.
 *
 * A screen named on the command line is stacked on top of the menu rather than
 * replacing it, so escaping out of one opened with `openchess puzzles` lands
 * where escaping out of one opened from the menu does.
 */
export function createAppRouter({ path, state, theme }: LaunchOptions) {
  return createMemoryRouter(
    [
      {
        path: "/",
        element: <RootLayout initialTheme={theme} />,
        children: [
          { index: true, element: <Home /> },
          ...SCREENS.map((screen) => ({
            path: screen.path,
            element: SCREEN_ELEMENTS[screen.name],
          })),
        ],
      },
    ],
    {
      initialEntries:
        path === "/" ? ["/"] : ["/", state ? { pathname: path, state } : path],
    },
  );
}
