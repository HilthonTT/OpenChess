import { STARTING_FEN, isStandardCastlingSetup } from "./board";
import { movePairs, type Game } from "./game";
import { openingOf } from "./opening-book";
import { startingFen } from "./pgn";

export type PgnTags = {
  event?: string;
  site?: string;
  date?: string;
  round?: string;
  white?: string;
  black?: string;
};

export type PgnResult = "1-0" | "0-1" | "1/2-1/2" | "*";

const SEVEN_TAG_DEFAULTS: Required<PgnTags> = {
  event: "OpenChess",
  site: "OpenChess",
  date: "????.??.??",
  round: "-",
  white: "?",
  black: "?",
};

function escapeTagValue(value: string): string {
  return value.replace(/[\\"]/g, (match) => `\\${match}`);
}

function wrap(tokens: string[], limit = 80): string {
  const lines: string[] = [];
  let line = "";

  for (const token of tokens) {
    if (line.length === 0) {
      line = token;
    } else if (line.length + 1 + token.length <= limit) {
      line += ` ${token}`;
    } else {
      lines.push(line);
      line = token;
    }
  }

  if (line.length > 0) {
    lines.push(line);
  }

  return lines.join("\n");
}

export function toMovetext(game: Game): string {
  const tokens = movePairs(game).flatMap(({ number, white, black }) => {
    const opening = white === "…" ? `${number}...` : `${number}. ${white}`;
    return black === null ? [opening] : [opening, black];
  });

  return wrap(tokens);
}

export function toPgn(
  game: Game,
  options: { result?: PgnResult; tags?: PgnTags } = {},
): string {
  const { result = "*", tags = {} } = options;
  const seven = { ...SEVEN_TAG_DEFAULTS, ...tags };

  const lines = [
    `[Event "${escapeTagValue(seven.event)}"]`,
    `[Site "${escapeTagValue(seven.site)}"]`,
    `[Date "${escapeTagValue(seven.date)}"]`,
    `[Round "${escapeTagValue(seven.round)}"]`,
    `[White "${escapeTagValue(seven.white)}"]`,
    `[Black "${escapeTagValue(seven.black)}"]`,
    `[Result "${result}"]`,
  ];

  const startPosition = game.history[0]?.before ?? game.position;
  if (!isStandardCastlingSetup(startPosition.castlingFiles)) {
    lines.push(`[Variant "Chess960"]`);
  }

  const start = startingFen(game);
  if (start !== STARTING_FEN) {
    lines.push(`[SetUp "1"]`, `[FEN "${start}"]`);
  }

  const opening = openingOf(game);
  if (opening) {
    lines.push(
      `[ECO "${escapeTagValue(opening.eco)}"]`,
      `[Opening "${escapeTagValue(opening.name)}"]`,
    );
  }

  const movetext = toMovetext(game);
  const body = movetext.length > 0 ? `${movetext} ${result}` : result;

  return `${lines.join("\n")}\n\n${body}\n`;
}
