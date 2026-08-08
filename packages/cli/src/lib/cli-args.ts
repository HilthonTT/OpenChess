import { parseFen, STARTING_FEN } from "@openchess/shared";
import pkg from "../../package.json";
import { THEMES, type Theme } from "../theme";
import {
  PIECE_SETS,
  PIECE_SET_DESCRIPTIONS,
  isPieceSet,
  type PieceSet,
} from "../components/pieces";
import {
  SCREENS,
  isScreenName,
  screenArgument,
  screenByName,
  type ScreenName,
} from "./screens";

/**
 * Router state for the route being opened. A screen that takes a name carries
 * one; Analysis carries whichever of a position or a file it was pointed at,
 * since `--fen` and `--pgn` open it on something that was never a game here.
 */
export type LaunchState =
  | { username: string }
  | { fen: string }
  | { pgnPath: string };

/** Where a successful parse lands the app. */
export type LaunchOptions = {
  /** The route to open on. */
  path: string;
  state?: LaunchState;
  /**
   * The theme for this session, or undefined to keep the saved one. `--theme`
   * is a look at one, not a change to the one you keep: it deliberately does
   * not write to the preferences file the picker writes to.
   */
  theme?: Theme;
  /**
   * Whether the terminal is rung when the queue pairs you or the opponent
   * moves. Undefined leaves whatever `OPENCHESS_BELL` said, which is the usual
   * case: the flags exist to overrule that setting for one session, in either
   * direction, so `--bell` is as necessary as `--no-bell`.
   */
  bell?: boolean;
  /**
   * The piece set for this session, or undefined to keep the saved one. Like
   * `--theme`, it does not write to the preferences file the picker writes to.
   */
  pieceSet?: PieceSet;
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
const BELL_FLAG = "--bell";
const NO_BELL_FLAG = "--no-bell";
const PIECES_FLAG = "--pieces";
const FEN_FLAG = "--fen";
const PGN_FLAG = "--pgn";

/** The screen `--fen` and `--pgn` are shorthand for. */
const ANALYSIS_SCREEN = "analysis";

/** The most fields a FEN has: placement, turn, castling, en passant, two clocks. */
const FEN_FIELDS = 6;

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

/** The sets there are, with what each is for, for `--pieces` and its errors. */
function pieceSetListText(): string {
  const width = Math.max(...PIECE_SETS.map((set) => set.length));
  return PIECE_SETS.map(
    (set) => `  ${set.padEnd(width)}  ${PIECE_SET_DESCRIPTIONS[set]}`,
  ).join("\n");
}

function unknownPieceSetText(query: string): string {
  return [
    `Unknown piece set "${query}".`,
    "There are:",
    pieceSetListText(),
  ].join("\n");
}

function unknownScreenText(name: string): string {
  return [
    `Unknown screen "${name}".`,
    `Run "openchess --help" for the ones there are.`,
  ].join("\n");
}

/**
 * The value written after a flag, and the last argument index it spent.
 *
 * `--flag=value` carries its own and must not eat the word after it; the
 * separate spelling spends the argument that follows.
 */
function flagValue(
  argv: readonly string[],
  index: number,
  flag: string,
): { value: string | undefined; last: number } {
  const arg = argv[index] as string;

  return arg.startsWith(`${flag}=`)
    ? { value: arg.slice(flag.length + 1), last: index }
    : { value: argv[index + 1], last: index + 1 };
}

/**
 * The FEN written after `--fen`, and the last argument index it spent.
 *
 * A FEN is six space-separated fields, so one the shell was not asked to keep
 * together arrives as six arguments rather than one — and typing the quotes is
 * exactly what someone pasting a position from another tool forgets. Fields are
 * gathered until the line runs out, another flag starts, or a screen is named,
 * which is what lets both spellings work without either being able to swallow
 * the rest of the command line.
 */
function readFen(
  argv: readonly string[],
  index: number,
): { fen: string; last: number } {
  const arg = argv[index] as string;

  if (arg.startsWith(`${FEN_FLAG}=`)) {
    return { fen: arg.slice(FEN_FLAG.length + 1), last: index };
  }

  const fields: string[] = [];
  let last = index;

  while (fields.length < FEN_FIELDS) {
    const next = argv[last + 1];
    if (next === undefined || next.startsWith("--") || isScreenName(next)) {
      break;
    }
    fields.push(next);
    last += 1;
  }

  return { fen: fields.join(" "), last };
}

/**
 * Whether `fen` is one the engine can set a board up from. Checked here rather
 * than on the screen so a mistyped position prints a line and leaves, instead
 * of clearing the terminal to say so.
 */
function isValidFen(fen: string): boolean {
  try {
    parseFen(fen);
    return true;
  } catch {
    return false;
  }
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
  ${FEN_FLAG} <fen>     Review a position — quotes optional
  ${PGN_FLAG} <file>    Review a game from a PGN file
  ${PIECES_FLAG} <set>  Draw the pieces as figurines or as letters
  ${NO_BELL_FLAG}       Don't ring the terminal for a match or a move
  ${BELL_FLAG}          Ring it even where OPENCHESS_BELL turned it off
  -v, --version   Print the version
  -h, --help      Print this

${FEN_FLAG} and ${PGN_FLAG} open Analysis on something you never played here,
and neither needs an account: the engine runs locally.

${PIECES_FLAG} takes one of:
${pieceSetListText()}
Use "letters" if the figurines come out clipped — most monospace fonts have no
chess glyphs, so the terminal borrows them from a font whose metrics do not fit.

Examples
  openchess puzzles
  openchess profile hikaru
  openchess --local --theme nord
  openchess ${PGN_FLAG} game.pgn
  openchess ${FEN_FLAG} "${STARTING_FEN}"`;
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
  let bell: boolean | undefined;
  let pieceSet: PieceSet | undefined;
  let fen: string | undefined;
  let pgnPath: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;

    if (arg === FEN_FLAG || arg.startsWith(`${FEN_FLAG}=`)) {
      const read = readFen(argv, index);
      index = read.last;

      if (read.fen === "") {
        return fail(
          `${FEN_FLAG} needs a position, e.g. ${FEN_FLAG} "${STARTING_FEN}".`,
        );
      }
      if (!isValidFen(read.fen)) {
        return fail(
          [
            `That isn't a position I can read: "${read.fen}".`,
            `A FEN looks like "${STARTING_FEN}".`,
          ].join("\n"),
        );
      }

      fen = read.fen;
      continue;
    }

    if (arg === PGN_FLAG || arg.startsWith(`${PGN_FLAG}=`)) {
      const read = flagValue(argv, index, PGN_FLAG);
      index = read.last;

      if (read.value === undefined || read.value === "") {
        return fail(`${PGN_FLAG} needs a path, e.g. ${PGN_FLAG} game.pgn.`);
      }

      pgnPath = read.value;
      continue;
    }

    if (arg === THEME_FLAG || arg.startsWith(`${THEME_FLAG}=`)) {
      const read = flagValue(argv, index, THEME_FLAG);
      index = read.last;

      const value = read.value;
      if (value === undefined || value === "") {
        return fail(
          `${THEME_FLAG} needs a theme name, e.g. ${THEME_FLAG} nord.`,
        );
      }

      const found = resolveTheme(value);
      if (found === undefined) {
        return fail(unknownThemeText(value));
      }

      theme = found;
      continue;
    }

    if (arg === PIECES_FLAG || arg.startsWith(`${PIECES_FLAG}=`)) {
      const read = flagValue(argv, index, PIECES_FLAG);
      index = read.last;

      const value = read.value;
      if (value === undefined || value === "") {
        return fail(
          `${PIECES_FLAG} needs a set. There are:\n${pieceSetListText()}`,
        );
      }

      const wanted = value.toLowerCase();
      if (!isPieceSet(wanted)) {
        return fail(unknownPieceSetText(value));
      }

      pieceSet = wanted;
      continue;
    }

    // Read before the general flag branch below, which would otherwise take
    // these for misspelled screens. The last one on the line wins, as the last
    // `--theme` does.
    if (arg === BELL_FLAG || arg === NO_BELL_FLAG) {
      bell = arg === BELL_FLAG;
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

  // Both name a position to open Analysis on, and the screen shows one game at
  // a time, so there is no reading of the two together worth guessing at.
  if (fen !== undefined && pgnPath !== undefined) {
    return fail(`Pick one: ${FEN_FLAG} or ${PGN_FLAG}, not both.`);
  }

  const position =
    fen !== undefined
      ? { fen }
      : pgnPath !== undefined
        ? { pgnPath }
        : undefined;

  if (position) {
    const flag = fen !== undefined ? FEN_FLAG : PGN_FLAG;

    if (screen !== undefined && screen !== ANALYSIS_SCREEN) {
      return fail(
        `${flag} opens the ${ANALYSIS_SCREEN} screen, so it cannot also open "${screen}".`,
      );
    }
    if (screenArg !== undefined) {
      return fail(`Unexpected argument "${screenArg}".`);
    }

    const entry = screenByName(ANALYSIS_SCREEN);
    if (entry === undefined) {
      return fail(unknownScreenText(ANALYSIS_SCREEN));
    }

    return {
      kind: "launch",
      options: { path: entry.path, state: position, theme, bell, pieceSet },
    };
  }

  // No screen named: the menu, which is where the game starts anyway.
  if (screen === undefined) {
    return { kind: "launch", options: { path: "/", theme, bell, pieceSet } };
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
    return {
      kind: "launch",
      options: { path: entry.path, theme, bell, pieceSet },
    };
  }

  if (screenArg === undefined) {
    return fail(
      `The ${screen} screen needs a ${placeholder}: openchess ${screenUsage(screen)}.`,
    );
  }

  return {
    kind: "launch",
    options: {
      path: entry.path,
      state: { username: screenArg },
      theme,
      bell,
      pieceSet,
    },
  };
}
