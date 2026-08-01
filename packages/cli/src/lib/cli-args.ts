import pkg from "../../package.json";
import { THEMES, type Theme } from "../theme";
import {
  SCREENS,
  isScreenName,
  screenArgument,
  screenByName,
  type ScreenName,
} from "./screens";

/** Where a successful parse lands the app. */
export type LaunchOptions = {
  /** The route to open on. */
  path: string;
  /** Router state for that route; only the screens that take a name have any. */
  state?: { username: string };
  /**
   * The theme for this session, or undefined to keep the saved one. `--theme`
   * is a look at one, not a change to the one you keep: it deliberately does
   * not write to the preferences file the picker writes to.
   */
  theme?: Theme;
};

/**
 * Either the app should start, or there is one thing to say and nothing to
 * run. Parsing returns which; it never prints or exits itself, so the whole of
 * it can be tested without a terminal.
 */
export type ParsedArgs =
  | { kind: "launch"; options: LaunchOptions }
  | { kind: "print"; text: string; code: number };

const THEME_FLAG = "--theme";

function fail(text: string): ParsedArgs {
  return { kind: "print", text, code: 1 };
}

/**
 * A theme name reduced to the letters and digits in it, so the spelling on the
 * command line does not have to match the one in the picker: `rose-pine`,
 * `Rosé Pine` and `rosepine` all name the same theme.
 */
function normalizeThemeName(value: string): string {
  return value
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function resolveTheme(query: string): Theme | undefined {
  const wanted = normalizeThemeName(query);
  return THEMES.find((theme) => normalizeThemeName(theme.name) === wanted);
}

/**
 * What to say about a theme nobody has. There are thirty-odd of them, so a
 * misspelling gets the handful it looks like rather than the whole list.
 */
function unknownThemeText(query: string): string {
  const wanted = normalizeThemeName(query);
  const near =
    wanted === ""
      ? []
      : THEMES.filter((theme) =>
          normalizeThemeName(theme.name).includes(wanted),
        ).map((theme) => theme.name);

  const lines = [`Unknown theme "${query}".`];
  if (near.length > 0) {
    lines.push(`Did you mean: ${near.join(", ")}?`);
  }
  lines.push(`Run "openchess --themes" for the full list.`);

  return lines.join("\n");
}

function unknownScreenText(name: string): string {
  return [
    `Unknown screen "${name}".`,
    `Run "openchess --help" for the ones there are.`,
  ].join("\n");
}

/** The label a screen is invoked by, with its placeholder when it needs one. */
function screenUsage(name: ScreenName): string {
  const screen = screenByName(name);
  const argument = screen ? screenArgument(screen) : undefined;
  return argument === undefined ? name : `${name} <${argument}>`;
}

function helpText(): string {
  const labels = SCREENS.map((screen) => screenUsage(screen.name));
  const width = Math.max(...labels.map((label) => label.length));

  const screens = SCREENS.map(
    (screen, index) =>
      `  ${(labels[index] as string).padEnd(width)}  ${screen.summary}`,
  ).join("\n");

  return `openchess — chess, in your terminal

Usage
  openchess [screen] [options]

Opens the menu when no screen is named. A screen may also be written as a
flag, so "openchess --puzzles" and "openchess puzzles" are the same thing.

Screens
${screens}

Options
  ${THEME_FLAG} <name>  Use a theme for this session, without saving it
  --themes        List the names ${THEME_FLAG} accepts
  -v, --version   Print the version
  -h, --help      Print this

Examples
  openchess puzzles
  openchess profile hikaru
  openchess --local --theme nord`;
}

function themeListText(): string {
  return THEMES.map((theme) => theme.name).join("\n");
}

/**
 * The flags that ask a question rather than start a game, answered wherever
 * they appear and before the rest of the line is judged. Somebody who typed a
 * flag wrong and added `--help` to find out why should get the help, not the
 * complaint about the flag.
 */
function query(argv: readonly string[]): ParsedArgs | undefined {
  if (argv.includes("-h") || argv.includes("--help")) {
    return { kind: "print", text: helpText(), code: 0 };
  }

  if (argv.includes("-v") || argv.includes("--version")) {
    return { kind: "print", text: `openchess ${pkg.version}`, code: 0 };
  }

  if (argv.includes("--themes")) {
    return { kind: "print", text: themeListText(), code: 0 };
  }

  return undefined;
}

/**
 * Read the command line.
 *
 * `--theme=nord` and `--theme nord` are the same, and so are `--local` and
 * `local`: the flag spelling exists because it is what people try, and there
 * is no reason for it to be wrong.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const asked = query(argv);
  if (asked) {
    return asked;
  }

  let screen: ScreenName | undefined;
  let screenArg: string | undefined;
  let theme: Theme | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;

    if (arg === THEME_FLAG || arg.startsWith(`${THEME_FLAG}=`)) {
      // Only the separate spelling spends the argument after it; the joined
      // one carries its value and must not eat the screen that follows.
      let value: string | undefined;
      if (arg.startsWith(`${THEME_FLAG}=`)) {
        value = arg.slice(THEME_FLAG.length + 1);
      } else {
        index += 1;
        value = argv[index];
      }

      if (value === undefined || value === "") {
        return fail(`${THEME_FLAG} needs a theme name, e.g. ${THEME_FLAG} nord.`);
      }

      const found = resolveTheme(value);
      if (found === undefined) {
        return fail(unknownThemeText(value));
      }

      theme = found;
      continue;
    }

    if (arg.startsWith("-")) {
      const name = arg.replace(/^--?/, "");
      if (!isScreenName(name)) {
        return fail(
          [
            `Unknown option "${arg}".`,
            `Run "openchess --help" for the ones there are.`,
          ].join("\n"),
        );
      }

      if (screen !== undefined && screen !== name) {
        return fail(`Pick one screen: "${screen}" or "${name}", not both.`);
      }

      screen = name;
      continue;
    }

    // A bare word is the screen, and then whatever that screen is about.
    if (screen === undefined) {
      if (!isScreenName(arg)) {
        return fail(unknownScreenText(arg));
      }
      screen = arg;
      continue;
    }

    if (screenArg === undefined) {
      screenArg = arg;
      continue;
    }

    return fail(`Unexpected argument "${arg}".`);
  }

  // No screen named: the menu, which is where the game starts anyway.
  if (screen === undefined) {
    return { kind: "launch", options: { path: "/", theme } };
  }

  const entry = screenByName(screen);
  if (entry === undefined) {
    return fail(unknownScreenText(screen));
  }

  const placeholder = screenArgument(entry);

  if (placeholder === undefined) {
    if (screenArg !== undefined) {
      return fail(
        `The ${screen} screen takes no argument, but got "${screenArg}".`,
      );
    }
    return { kind: "launch", options: { path: entry.path, theme } };
  }

  if (screenArg === undefined) {
    return fail(
      `The ${screen} screen needs a ${placeholder}: openchess ${screenUsage(screen)}.`,
    );
  }

  return {
    kind: "launch",
    options: { path: entry.path, state: { username: screenArg }, theme },
  };
}
