import { describe, expect, test } from "bun:test";

import { STARTING_FEN } from "./board";
import { createGame } from "./game";
import { parsePgn, splitPgnGames } from "./pgn-parse";
import { toPgn } from "./pgn-text";
import { playSan } from "./pgn";

const SCHOLARS_MATE = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];

function played(sans: string[]) {
  let game = createGame();
  for (const san of sans) {
    game = playSan(game, san);
  }
  return game;
}

describe("parsePgn", () => {
  test("reads the tags, the moves and the result", () => {
    const parsed = parsePgn(`[Event "OpenChess online game"]
[Site "OpenChess"]
[Date "2026.07.24"]
[Round "-"]
[White "alice"]
[Black "bob"]
[Result "1-0"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0
`);

    expect(parsed.tags.white).toBe("alice");
    expect(parsed.tags.black).toBe("bob");
    expect(parsed.result).toBe("1-0");
    expect(parsed.moves).toEqual(SCHOLARS_MATE);
    expect(parsed.game.status).toBe("checkmate");
  });

  test("round-trips what toPgn writes", () => {
    const pgn = toPgn(played(SCHOLARS_MATE), {
      result: "1-0",
      tags: { white: "alice", black: "bob" },
    });

    const parsed = parsePgn(pgn);

    expect(parsed.moves).toEqual(SCHOLARS_MATE);
    expect(parsed.result).toBe("1-0");
    expect(parsed.startingFen).toBe(STARTING_FEN);
  });

  test("round-trips a game that began from a set-up position", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const game = playSan(createGame(fen), "e5");

    const parsed = parsePgn(toPgn(game, { result: "*" }));

    expect(parsed.startingFen).toBe(fen);
    expect(parsed.moves).toEqual(["e5"]);
  });

  test("drops comments, variations, NAGs and annotation marks", () => {
    const parsed = parsePgn(`[Event "?"]

1. e4! {best by test} e5 $1 2. Nf3?! (2. Bc4 Nc6 {a comment inside a line}) 2... Nc6 *
`);

    expect(parsed.moves).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  test("a semicolon comment runs only to the end of its line", () => {
    const parsed = parsePgn(`[Event "?"]

1. e4 ; this is a comment
1... e5 2. Nf3 *
`);

    expect(parsed.moves).toEqual(["e4", "e5", "Nf3"]);
  });

  test("reads movetext with no blank line after the tags", () => {
    const parsed = parsePgn(`[Event "?"]
[White "alice"]
1. e4 e5 *`);

    expect(parsed.moves).toEqual(["e4", "e5"]);
  });

  test("reads move numbers written tight against the move", () => {
    expect(parsePgn("1.e4 e5 2.Nf3 Nc6 *").moves).toEqual([
      "e4",
      "e5",
      "Nf3",
      "Nc6",
    ]);
  });

  test("falls back to the Result tag when the movetext omits the token", () => {
    expect(parsePgn(`[Result "0-1"]\n\n1. e4 e5`).result).toBe("0-1");
  });

  test("a file with no moves parses as the starting position", () => {
    const parsed = parsePgn(`[Event "?"]\n[Result "*"]\n\n*\n`);

    expect(parsed.moves).toEqual([]);
    expect(parsed.game.history).toEqual([]);
  });

  // The whole point of replaying rather than trusting the file: a move list
  // that does not describe a real game must not reach a board.
  test("refuses a move that is not legal, naming it", () => {
    expect(() => parsePgn("1. e4 e5 2. Qxf7#")).toThrow(/Qxf7/);
  });

  test("refuses an unreadable FEN tag", () => {
    expect(() => parsePgn(`[FEN "not a position"]\n\n*`)).toThrow(/FEN tag/);
  });

  test("undoes the spec's backslash escapes in tag values", () => {
    expect(parsePgn(`[White "he said \\"hi\\""]\n\n*`).tags.white).toBe(
      'he said "hi"',
    );
  });
});

describe("splitPgnGames", () => {
  test("splits on the tag line that follows movetext", () => {
    const games = splitPgnGames(`[Event "one"]
[Result "1-0"]

1. e4 e5 1-0

[Event "two"]
[Result "0-1"]

1. d4 d5 0-1
`);

    expect(games).toHaveLength(2);
    expect(parsePgn(games[0]!).tags.event).toBe("one");
    expect(parsePgn(games[1]!).moves).toEqual(["d4", "d5"]);
  });

  test("a single game comes back whole", () => {
    expect(splitPgnGames(`[Event "one"]\n\n1. e4 *\n`)).toHaveLength(1);
  });

  test("an empty file has no games in it", () => {
    expect(splitPgnGames("\n\n")).toEqual([]);
  });
});
