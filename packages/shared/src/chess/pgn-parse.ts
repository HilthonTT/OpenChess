import { STARTING_FEN } from "./board";
import { createGame, play, type Game } from "./game";
import { findSanMove } from "./pgn";
import type { PgnResult, PgnTags } from "./pgn-text";

/**
 * PGN import.
 *
 * `pgn-text.ts` writes the archival format; this reads it back. The two are
 * deliberately asymmetric: we emit one canonical shape, and have to accept
 * whatever a real file contains — comments, variations, annotation glyphs,
 * clock times, a game that starts from a `FEN` tag rather than the initial
 * array. Everything that is decoration is dropped, and what survives is the
 * mainline, replayed through the same rules the rest of the engine runs.
 *
 * @see https://www.thechessdrum.net/PGN_Reference.txt
 */

export type ParsedPgn = {
  /** The seven-tag roster and any other tags the file carried, by lowercase key. */
  tags: PgnTags & Record<string, string>;
  /** The result token from the movetext, or from the `Result` tag. */
  result: PgnResult;
  /** The position the game starts from — the `FEN` tag, or the initial array. */
  startingFen: string;
  /**
   * The mainline in SAN — as the engine spells it, not as the file did, so a
   * move written `Qxf7#`, `Qxf7+!` or `Qf7xf7` all come back canonical.
   */
  moves: string[];
  /** The mainline replayed. Its status and history are fully populated. */
  game: Game;
};

const RESULTS: readonly string[] = ["1-0", "0-1", "1/2-1/2", "*"];

function isResult(token: string): token is PgnResult {
  return RESULTS.includes(token);
}

/** `[White "Kasparov"]`, with the spec's backslash escapes undone. */
const TAG_LINE = /^\[\s*([A-Za-z0-9_]+)\s*"((?:[^"\\]|\\.)*)"\s*\]$/;

/**
 * Split the file into its tag pairs and its movetext.
 *
 * The two sections are separated by a blank line in a well-formed file, but
 * plenty of exporters omit it — so the split is driven by the shape of each
 * line instead: bracketed tag lines belong to the header until a line that
 * isn't one appears, and everything from there on is movetext.
 */
function splitSections(pgn: string): {
  tags: Record<string, string>;
  movetext: string;
} {
  const tags: Record<string, string> = {};
  const body: string[] = [];
  let inHeader = true;

  for (const raw of pgn.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();

    if (inHeader) {
      if (line === "") {
        continue;
      }

      const match = TAG_LINE.exec(line);
      if (match) {
        // Keys are case-insensitive in practice; lowercase them so a file
        // writing `WHITE` reads the same as one writing `White`.
        tags[match[1]!.toLowerCase()] = match[2]!.replace(/\\(.)/g, "$1");
        continue;
      }

      inHeader = false;
    }

    body.push(line);
  }

  return { tags, movetext: body.join("\n") };
}

/**
 * Strip everything that isn't a move token.
 *
 * Done as a character scan rather than a chain of regexes because the
 * constructs nest: a comment can contain a brace-free parenthesis, a variation
 * can contain a comment, and a `;` comment runs to the end of its line. A
 * regex pass would mis-pair those and eat mainline moves.
 */
function stripAnnotations(movetext: string): string {
  let out = "";
  let braceDepth = 0;
  let parenDepth = 0;
  let lineComment = false;

  for (let i = 0; i < movetext.length; i += 1) {
    const ch = movetext[i]!;

    if (lineComment) {
      if (ch === "\n") {
        lineComment = false;
        out += " ";
      }
      continue;
    }

    if (braceDepth > 0) {
      if (ch === "}") {
        braceDepth -= 1;
        out += " ";
      } else if (ch === "{") {
        // Not legal PGN, but nesting them is the forgiving reading.
        braceDepth += 1;
      }
      continue;
    }

    // A variation is an alternative to the mainline, not part of it. Its
    // contents are skipped wholesale, comments and sub-variations included.
    if (parenDepth > 0) {
      if (ch === "(") {
        parenDepth += 1;
      } else if (ch === ")") {
        parenDepth -= 1;
        out += " ";
      } else if (ch === "{") {
        braceDepth += 1;
      }
      continue;
    }

    if (ch === "{") {
      braceDepth += 1;
      continue;
    }
    if (ch === "(") {
      parenDepth += 1;
      continue;
    }
    if (ch === ";") {
      lineComment = true;
      continue;
    }
    // A stray `}` or `)` is unbalanced input; dropping it is kinder than
    // failing, and the move tokens around it still read correctly.
    if (ch === "}" || ch === ")") {
      continue;
    }

    out += ch;
  }

  return out;
}

/** A move number (`1.`, `12...`), a NAG (`$7`), or the `...` that resumes black. */
const NOISE = /^(?:\d+\.*|\.+|\$\d+)$/;

/** The `!?` family, written attached to the move rather than as a NAG. */
const ANNOTATION_SUFFIX = /[!?]+$/;

/**
 * The move tokens, in order, with the result token removed. Everything left is
 * SAN for `findSanMove` to resolve against the position it reaches.
 */
function tokenize(movetext: string): { moves: string[]; result: PgnResult } {
  let result: PgnResult = "*";
  const moves: string[] = [];

  for (const token of stripAnnotations(movetext).split(/\s+/)) {
    if (token === "") {
      continue;
    }

    if (isResult(token)) {
      result = token;
      continue;
    }

    if (NOISE.test(token)) {
      continue;
    }

    // `1.e4` with no space is legal, and common from engines that wrap tightly.
    const stripped = token.replace(/^\d+\.+/, "").replace(ANNOTATION_SUFFIX, "");
    if (stripped === "" || NOISE.test(stripped)) {
      continue;
    }

    moves.push(stripped);
  }

  return { moves, result };
}

/** The `Result` tag as a result token, when the movetext carried none. */
function resultFromTag(value: string | undefined): PgnResult | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.replace(/½/g, "1/2").trim();
  return isResult(normalized) ? normalized : null;
}

/**
 * Parse one PGN game.
 *
 * Throws on the first move that is not legal in the position it reaches,
 * naming the move and its index — a file whose moves do not replay describes a
 * game that was never played, and silently truncating it would put a board on
 * screen that never existed.
 *
 * Only the first game in a file is read. A multi-game file is split by
 * `splitPgnGames` first.
 */
export function parsePgn(pgn: string): ParsedPgn {
  const { tags, movetext } = splitSections(pgn);
  const { moves, result } = tokenize(movetext);

  // A `SetUp "1"` tag is what the spec says licenses `FEN`, but files that
  // carry the position without the flag are everywhere — and a `FEN` tag is
  // unambiguous on its own, so honour it either way.
  const startingFen = tags.fen?.trim() || STARTING_FEN;

  let game: Game;
  try {
    game = createGame(startingFen);
  } catch (error) {
    throw new Error(
      `PGN has an unreadable FEN tag "${startingFen}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  for (const [index, san] of moves.entries()) {
    const move = findSanMove(game, san);
    if (!move) {
      throw new Error(
        `Illegal or unreadable move "${san}" at index ${index} of ${moves.length}`,
      );
    }
    game = play(game, move);
  }

  return {
    tags,
    // The movetext's token wins: it is the one the moves actually terminate
    // with. The tag is the fallback for a file that omits the token entirely.
    result: result === "*" ? (resultFromTag(tags.result) ?? "*") : result,
    startingFen,
    // Taken from the replay rather than the file: the engine's own SAN is what
    // every other consumer of a move list in this codebase speaks.
    moves: game.history.map((entry) => entry.san),
    game,
  };
}

/**
 * Split a file holding several games into one string each.
 *
 * The boundary is a tag line that follows movetext: within one game the tag
 * pairs are contiguous, so the first `[Tag "…"]` after a non-tag line begins
 * the next game. A file with a single game comes back as a single element.
 */
export function splitPgnGames(pgn: string): string[] {
  const games: string[] = [];
  let current: string[] = [];
  let sawMovetext = false;

  for (const raw of pgn.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const isTag = TAG_LINE.test(line);

    if (isTag && sawMovetext) {
      games.push(current.join("\n"));
      current = [];
      sawMovetext = false;
    }

    if (!isTag && line !== "") {
      sawMovetext = true;
    }

    current.push(raw);
  }

  const last = current.join("\n");
  if (last.trim() !== "") {
    games.push(last);
  }

  return games;
}
