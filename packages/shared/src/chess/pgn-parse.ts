import { STARTING_FEN } from "./board";
import { createGame, play, type Game } from "./game";
import { findSanMove } from "./pgn";
import type { PgnResult, PgnTags } from "./pgn-text";

export type ParsedPgn = {
  tags: PgnTags & Record<string, string>;
  result: PgnResult;
  startingFen: string;
  moves: string[];
  game: Game;
};

const RESULTS: readonly string[] = ["1-0", "0-1", "1/2-1/2", "*"];

function isResult(token: string): token is PgnResult {
  return RESULTS.includes(token);
}

const TAG_LINE = /^\[\s*([A-Za-z0-9_]+)\s*"((?:[^"\\]|\\.)*)"\s*\]$/;

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
        tags[match[1]!.toLowerCase()] = match[2]!.replace(/\\(.)/g, "$1");
        continue;
      }

      inHeader = false;
    }

    body.push(line);
  }

  return { tags, movetext: body.join("\n") };
}

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
        braceDepth += 1;
      }
      continue;
    }

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
    if (ch === "}" || ch === ")") {
      continue;
    }

    out += ch;
  }

  return out;
}

const NOISE = /^(?:\d+\.*|\.+|\$\d+)$/;

const ANNOTATION_SUFFIX = /[!?]+$/;

function tokenize(movetext: string): { moves: string[]; result: PgnResult } {
  let result: PgnResult = "*";
  const moves: string[] = [];

  for (const raw of stripAnnotations(movetext).split(/\s+/)) {
    const token = raw.replace(/½/g, "1/2");
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

    const stripped = token
      .replace(/^\d+\.+/, "")
      .replace(ANNOTATION_SUFFIX, "");
    if (stripped === "" || NOISE.test(stripped)) {
      continue;
    }

    moves.push(stripped);
  }

  return { moves, result };
}

function resultFromTag(value: string | undefined): PgnResult | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.replace(/½/g, "1/2").trim();
  return isResult(normalized) ? normalized : null;
}

export function parsePgn(pgn: string): ParsedPgn {
  const { tags, movetext } = splitSections(pgn);
  const { moves, result } = tokenize(movetext);

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
    result: result === "*" ? (resultFromTag(tags.result) ?? "*") : result,
    startingFen,
    moves: game.history.map((entry) => entry.san),
    game,
  };
}

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
