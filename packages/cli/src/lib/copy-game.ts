import { toFen, toPgn } from "@openchess/shared";
import type { Game, PgnResult, PgnTags } from "@openchess/shared";
import { copyToClipboard, type ClipboardTarget } from "./clipboard";
import type { ServerGame } from "./games";

export type PgnDetails = {
  result?: PgnResult;
  tags?: PgnTags;
};

export function pgnResultOf(game: Game): PgnResult {
  switch (game.status) {
    case "checkmate":
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

export function pgnResultOfServer(result: ServerGame["result"]): PgnResult {
  switch (result) {
    case "WHITE_WIN":
      return "1-0";
    case "BLACK_WIN":
      return "0-1";
    case "DRAW":
      return "1/2-1/2";
    case "ABORTED":
    case null:
      return "*";
  }
}

function pgnDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, ".");
}

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

export function copyFen(game: Game, target?: ClipboardTarget): string {
  const outcome = copyToClipboard(toFen(game.position), target);
  return outcome.ok
    ? "Position copied as FEN — shift+y copies the game"
    : refusal(outcome.reason);
}

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
