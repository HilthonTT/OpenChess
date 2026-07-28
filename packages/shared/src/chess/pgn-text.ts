import { STARTING_FEN, isStandardCastlingSetup } from "./board";
import { movePairs, type Game } from "./game";
import { openingOf } from "./opening-book";
import { startingFen } from "./pgn";

/**
 * PGN export.
 *
 * `pgn.ts` next door is about *records* — the UCI move list the server persists
 * and replays. This is the human-facing sibling: the archival text format, the
 * thing you paste into an analysis board. They are deliberately separate, since
 * the record has to round-trip exactly and the text does not.
 *
 * @see https://www.thechessdrum.net/PGN_Reference.txt
 */

/** The seven tags the PGN spec requires, in the order it requires them. */
export type PgnTags = {
  event?: string;
  site?: string;
  /** `YYYY.MM.DD`; `??` for unknown components, per the spec. */
  date?: string;
  round?: string;
  white?: string;
  black?: string;
};

/** PGN's result tokens. `*` means the game is still in progress. */
export type PgnResult = "1-0" | "0-1" | "1/2-1/2" | "*";

const SEVEN_TAG_DEFAULTS: Required<PgnTags> = {
  event: "OpenChess",
  site: "OpenChess",
  date: "????.??.??",
  round: "-",
  white: "?",
  black: "?",
};

/** PGN quotes tag values, so a quote or backslash inside one has to be escaped. */
function escapeTagValue(value: string): string {
  return value.replace(/[\\"]/g, (match) => `\\${match}`);
}

/**
 * Wrap at 80 columns on token boundaries. The spec caps lines at 80 characters,
 * and a reader that splits a move number from its move is entitled to reject the
 * file — so we never break inside a token.
 */
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

/** The movetext: `1. e4 e5 2. Nf3` — no tags, no result token. */
export function toMovetext(game: Game): string {
  const tokens = movePairs(game).flatMap(({ number, white, black }) => {
    // `movePairs` renders a game that began mid-move with an ellipsis for the
    // absent white move; PGN spells that as `1... e5`, and writing the ellipsis
    // through verbatim would produce a file no reader accepts.
    const opening = white === "…" ? `${number}...` : `${number}. ${white}`;
    return black === null ? [opening] : [opening, black];
  });

  return wrap(tokens);
}

/**
 * Render `game` as PGN. `result` is the game's outcome — pass `*` (the default)
 * for a game still in progress, which is also what an adjourned game gets.
 */
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

  // A shuffled game has to say so. Without it a reader has a legal-looking FEN
  // and no reason to expect `O-O` to move a king that is not on e1, and the
  // castling field's file letters — which is how it would find out — are
  // exactly the part a standard-chess reader is entitled to reject.
  const startPosition = game.history[0]?.before ?? game.position;
  if (!isStandardCastlingSetup(startPosition.castlingFiles)) {
    lines.push(`[Variant "Chess960"]`);
  }

  // A game that did not start from the initial array is unreadable without the
  // position it did start from. `SetUp` is what tells a reader to honor `FEN`.
  const start = startingFen(game);
  if (start !== STARTING_FEN) {
    lines.push(`[SetUp "1"]`, `[FEN "${start}"]`);
  }

  // `ECO` and `Opening` are supplemental tags, so they follow the seven. Written
  // only when the book recognises the game: a position it never saw gets no tag
  // at all, which is the honest answer and the one a reader expects — an
  // `[Opening "?"]` is a claim that the opening is unknown rather than unasked.
  const opening = openingOf(game);
  if (opening) {
    lines.push(
      `[ECO "${escapeTagValue(opening.eco)}"]`,
      `[Opening "${escapeTagValue(opening.name)}"]`,
    );
  }

  const movetext = toMovetext(game);
  // The result token terminates the movetext, on the same line when there is one.
  const body = movetext.length > 0 ? `${movetext} ${result}` : result;

  return `${lines.join("\n")}\n\n${body}\n`;
}
