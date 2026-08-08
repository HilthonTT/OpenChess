/**
 * The screens the CLI can open directly, and the one place that says so.
 *
 * The router builds its children from this list and the argument parser
 * validates against it, so a screen added here reaches both at once — and a
 * name a user types can never point at a route that no longer exists.
 */
type Screen = {
  /** What the user types: `openchess puzzles`, or `--puzzles`. */
  readonly name: string;
  /** The route it opens. */
  readonly path: string;
  /** The one line `--help` prints beside the name. */
  readonly summary: string;
  /**
   * The placeholder for the word that has to follow, on the screens that are
   * about someone in particular. Absent on the screens that stand alone.
   */
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

/**
 * The placeholder a screen needs after it, or undefined when it takes nothing.
 * Read through here rather than off the entry: only some of them carry the
 * field, so the list is a union that has to be narrowed before it is asked.
 */
export function screenArgument(screen: ScreenEntry): string | undefined {
  return "argument" in screen ? screen.argument : undefined;
}
