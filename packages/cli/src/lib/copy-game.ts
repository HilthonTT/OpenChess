import { toFen, toPgn } from "@openchess/shared";
import type { Game, PgnResult, PgnTags } from "@openchess/shared";
import { copyToClipboard, type ClipboardTarget } from "./clipboard";
import type { ServerGame } from "./games";

/**
 * The two things worth copying out of a chess game, and the lines that say so.
 *
 * A position is a FEN and a game is a PGN, which is the whole of the format
 * question: both are what every other board on the internet reads, so a position
 * yanked here pastes into Lichess, a database or a message to somebody who will
 * tell you what you should have played.
 *
 * These return the note to show rather than an outcome to interpret, because
 * every caller does the same thing with it — hands it to the status line.
 */

/** PGN header overrides for a game whose players the screen happens to know. */
export type PgnDetails = {
  result?: PgnResult;
  tags?: PgnTags;
};

/**
 * The result token a position argues for. A game still being played is `*`,
 * which is also what a game that ended some way the board cannot see — a
 * resignation, a flag, an abort — gets unless the screen says otherwise.
 */
export function pgnResultOf(game: Game): PgnResult {
  switch (game.status) {
    case "checkmate":
      // The side to move is the side that is mated.
      return game.position.turn === "w" ? "0-1" : "1-0";
    case "stalemate":
    case "draw-fifty-move":
    case "draw-repetition":
    case "draw-insufficient-material":
      return "1/2-1/2";
    case "check":
    case "playing":
      return "*";
  }
}

/** The server's result, as PGN spells it. An unfinished game is `*`. */
export function pgnResultOfServer(result: ServerGame["result"]): PgnResult {
  switch (result) {
    case "WHITE_WIN":
      return "1-0";
    case "BLACK_WIN":
      return "0-1";
    case "DRAW":
      return "1/2-1/2";
    // An aborted game reached no result, which is what `*` means.
    case "ABORTED":
    case null:
      return "*";
  }
}

/** `2025-08-02T…` as PGN dates it. */
function pgnDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, ".");
}

/**
 * The headers for a game the server holds — the one case where real names, a
 * real date and a result the board cannot infer are all to hand.
 */
export function serverPgnDetails(input: {
  event: string;
  startedAt: string;
  result: ServerGame["result"];
  white: string;
  black: string;
}): PgnDetails {
  return {
    result: pgnResultOfServer(input.result),
    tags: {
      event: input.event,
      site: "OpenChess",
      date: pgnDate(input.startedAt),
      round: "-",
      white: input.white,
      black: input.black,
    },
  };
}

function refusal(reason: string): string {
  return `Couldn't copy: ${reason}`;
}

/**
 * Copy the position on the board. The trailing hint is worth the width: `y` is
 * the key somebody presses first, and it is the only place the second one gets
 * mentioned outside the footer.
 */
export function copyFen(game: Game, target?: ClipboardTarget): string {
  const outcome = copyToClipboard(toFen(game.position), target);
  return outcome.ok
    ? "Position copied as FEN — shift+y copies the game"
    : refusal(outcome.reason);
}

/** Copy the whole game, from its first move to wherever it has got to. */
export function copyPgn(
  game: Game,
  details: PgnDetails = {},
  target?: ClipboardTarget,
): string {
  const pgn = toPgn(game, {
    result: details.result ?? pgnResultOf(game),
    tags: details.tags,
  });

  const outcome = copyToClipboard(pgn, target);
  return outcome.ok ? "Game copied as PGN" : refusal(outcome.reason);
}
