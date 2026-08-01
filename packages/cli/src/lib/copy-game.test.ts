import { describe, expect, test } from "bun:test";
import { createGame, playSan, toFen } from "@openchess/shared";
import type { Game } from "@openchess/shared";
import {
  copyFen,
  copyPgn,
  pgnResultOf,
  pgnResultOfServer,
  serverPgnDetails,
} from "./copy-game";

const PREFIX_LENGTH = `${String.fromCharCode(0x1b)}]52;c;`.length;

function terminal() {
  const written: string[] = [];

  return {
    isTTY: true,
    write: (chunk: string) => written.push(chunk),
    written,
    clipboard: () =>
      Buffer.from(
        (written.at(-1) ?? "").slice(PREFIX_LENGTH, -1),
        "base64",
      ).toString("utf8"),
  };
}

/** Play a line out from the initial array. */
function played(...moves: string[]): Game {
  return moves.reduce(playSan, createGame());
}

describe("copying a position", () => {
  test("puts the FEN of the position on the clipboard", () => {
    const out = terminal();
    const game = played("e4", "e5", "Nf3");

    expect(copyFen(game, out)).toContain("Position copied as FEN");
    expect(out.clipboard()).toBe(toFen(game.position));
  });

  test("says why when the terminal won't take it", () => {
    const note = copyFen(createGame(), {
      write: () => undefined,
    });

    expect(note).toBe("Couldn't copy: this isn't a terminal");
  });
});

describe("copying a game", () => {
  test("puts a PGN with the moves and the headers it was given on the clipboard", () => {
    const out = terminal();

    const note = copyPgn(
      played("e4", "e5", "Nf3"),
      {
        result: "*",
        tags: { event: "OpenChess local game", white: "hikaru", black: "you" },
      },
      out,
    );

    expect(note).toBe("Game copied as PGN");

    const pgn = out.clipboard();
    expect(pgn).toContain(`[Event "OpenChess local game"]`);
    expect(pgn).toContain(`[White "hikaru"]`);
    expect(pgn).toContain(`[Black "you"]`);
    expect(pgn).toContain("1. e4 e5 2. Nf3 *");
  });

  test("reads the result off the board when the screen doesn't name one", () => {
    const out = terminal();
    // Fool's mate: black gives it, so the result is black's.
    copyPgn(played("f3", "e5", "g4", "Qh4#"), {}, out);

    expect(out.clipboard()).toContain(`[Result "0-1"]`);
  });

  test("a game still being played is copied as unfinished", () => {
    expect(pgnResultOf(played("e4"))).toBe("*");
    expect(pgnResultOf(played("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#")))
      .toBe("1-0");
  });
});

describe("the headers a server game carries", () => {
  test("name the players, the day and the result", () => {
    const details = serverPgnDetails({
      event: "OpenChess online game",
      startedAt: "2026-08-02T18:24:11.000Z",
      result: "BLACK_WIN",
      white: "hikaru",
      black: "magnus",
    });

    expect(details.result).toBe("0-1");
    expect(details.tags).toMatchObject({
      event: "OpenChess online game",
      date: "2026.08.02",
      white: "hikaru",
      black: "magnus",
    });
  });

  test("an unfinished or aborted game reached no result", () => {
    // `*` is PGN for "no result", which is what both of these are — an aborted
    // game is not a draw, and writing it as one would invent half a point.
    expect(pgnResultOfServer(null)).toBe("*");
    expect(pgnResultOfServer("ABORTED")).toBe("*");
    expect(pgnResultOfServer("DRAW")).toBe("1/2-1/2");
    expect(pgnResultOfServer("WHITE_WIN")).toBe("1-0");
  });
});
