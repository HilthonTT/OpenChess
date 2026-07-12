import { describe, expect, test } from "bun:test";

import { createGame } from "./game";
import { fromRecord, playSan } from "./pgn";
import { toMovetext, toPgn } from "./pgn-text";

/** Scholar's mate: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7# */
const SCHOLARS_MATE = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7"];

function played(sans: string[]) {
  let game = createGame();
  for (const san of sans) {
    game = playSan(game, san);
  }
  return game;
}

describe("toMovetext", () => {
  test("numbers the pairs", () => {
    expect(toMovetext(played(["e4", "e5", "Nf3"]))).toBe("1. e4 e5 2. Nf3");
  });

  test("a game with no moves has no movetext", () => {
    expect(toMovetext(createGame())).toBe("");
  });

  test("wraps at 80 columns without splitting a token", () => {
    const movetext = toMovetext(played(SCHOLARS_MATE));

    for (const line of movetext.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  // `movePairs` renders a missing white move as "…", which no PGN reader accepts.
  test("a game that starts on black's move uses PGN's ellipsis, not a typographic one", () => {
    const game = fromRecord({
      fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
      moves: ["e7e5"],
    });

    const movetext = toMovetext(game);

    expect(movetext).toBe("1... e5");
    expect(movetext).not.toContain("…");
  });
});

describe("toPgn", () => {
  test("carries the seven required tags, in order", () => {
    const pgn = toPgn(played(["e4"]), {
      result: "*",
      tags: { white: "alice", black: "OpenChess Bot (hard)" },
    });

    const tags = [...pgn.matchAll(/^\[(\w+) /gm)].map((match) => match[1]);

    expect(tags.slice(0, 7)).toEqual([
      "Event",
      "Site",
      "Date",
      "Round",
      "White",
      "Black",
      "Result",
    ]);
  });

  test("terminates the movetext with the result token", () => {
    const pgn = toPgn(played(SCHOLARS_MATE), { result: "1-0" });

    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn.trimEnd().endsWith("1-0")).toBe(true);
    expect(pgn).toContain("4. Qxf7");
  });

  test("a game with no moves is still a legal PGN", () => {
    const pgn = toPgn(createGame(), { result: "*" });

    // A blank line separates the tag pair section from the movetext.
    expect(pgn).toContain("\n\n*");
  });

  test("escapes a quote in a tag rather than closing the tag early", () => {
    const pgn = toPgn(createGame(), { tags: { white: 'al"ice' } });

    expect(pgn).toContain('[White "al\\"ice"]');
  });

  // Without SetUp+FEN a reader would replay the moves from the initial array.
  test("a game from a custom position declares SetUp and FEN", () => {
    const fen = "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1";
    const game = fromRecord({ fen, moves: ["e2e4"] });

    const pgn = toPgn(game, { result: "*" });

    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${fen}"]`);
  });

  test("a standard game declares neither", () => {
    const pgn = toPgn(played(["e4"]), { result: "*" });

    expect(pgn).not.toContain("SetUp");
    expect(pgn).not.toContain("[FEN");
  });
});
