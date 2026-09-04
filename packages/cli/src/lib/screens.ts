type Screen = {
  readonly name: string;
  readonly path: string;
  readonly summary: string;
  readonly argument?: string;
};

export const SCREENS = [
  {
    name: "local",
    path: "/local",
    summary: "Two players sharing one keyboard",
  },
  {
    name: "online",
    path: "/online",
    summary: "Play the next player in the queue",
  },
  { name: "ai", path: "/ai", summary: "Play the engine" },
  {
    name: "puzzles",
    path: "/puzzles",
    summary: "Train tactics, one position at a time",
  },
  { name: "rush", path: "/rush", summary: "Race the clock, three mistakes" },
  {
    name: "collections",
    path: "/collections",
    summary: "Sets of puzzles, one motif at a time",
  },
  {
    name: "challenges",
    path: "/challenges",
    summary: "Challenge a friend, or take one on",
  },
  {
    name: "friends",
    path: "/friends",
    summary: "Who's around, and who's asked",
  },
  { name: "watch", path: "/watch", summary: "Look in on a game in progress" },
  { name: "leaderboard", path: "/leaderboard", summary: "See where you rank" },
  {
    name: "achievements",
    path: "/achievements",
    summary: "Trophies you have earned",
  },
  { name: "stats", path: "/stats", summary: "Your record, rating and streaks" },
  {
    name: "analysis",
    path: "/analysis",
    summary: "Review a finished game with the engine",
  },
  {
    name: "repertoire",
    path: "/repertoire",
    summary: "Drill the openings you keep",
  },
  {
    name: "explorer",
    path: "/explorer",
    summary: "Walk the book, by name or by move",
  },
  { name: "store", path: "/store", summary: "Spend coins on titles" },
  {
    name: "profile",
    path: "/profile",
    argument: "username",
    summary: "Somebody's record, by name",
  },
] as const satisfies readonly Screen[];

export type ScreenEntry = (typeof SCREENS)[number];
export type ScreenName = ScreenEntry["name"];

export function screenByName(name: string) {
  return SCREENS.find((screen) => screen.name === name);
}

export function isScreenName(value: string): value is ScreenName {
  return screenByName(value) !== undefined;
}

export function screenArgument(screen: ScreenEntry): string | undefined {
  return "argument" in screen ? screen.argument : undefined;
}
