import { describe, expect, test } from "bun:test";
import {
  createGame,
  findUciMove,
  isPlayablePuzzle,
  play,
  startPuzzle,
  submitPuzzleMove,
  type Game,
} from "@openchess/shared";

import { PUZZLE_CATALOG } from "./puzzle-catalog";

function replay(fen: string, moves: string[]): Game {
  let game = createGame(fen);
  for (const uci of moves) {
    const move = findUciMove(game, uci);
    if (!move) {
      throw new Error(`illegal ${uci}`);
    }
    game = play(game, move);
  }
  return game;
}

describe("the built-in puzzle catalog", () => {
  test("has no duplicate keys", () => {
    const ids = PUZZLE_CATALOG.map((puzzle) => puzzle.externalId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("is not empty — a seeded database must have something to serve", () => {
    expect(PUZZLE_CATALOG.length).toBeGreaterThan(0);
  });

  for (const puzzle of PUZZLE_CATALOG) {
    describe(puzzle.externalId, () => {
      test("replays from its position", () => {
        expect(isPlayablePuzzle(puzzle)).toBe(true);
      });

      test("is solved by its own recorded line", () => {
        let session = startPuzzle({ ...puzzle, id: puzzle.externalId });

        for (let i = 1; i < puzzle.moves.length; i += 2) {
          const result = submitPuzzleMove(session, puzzle.moves[i]!);
          expect(result.outcome).not.toBe("wrong");
          session = result.session;
        }

        expect(session.status).toBe("solved");
      });

      test("its rating is on the ladder's scale", () => {
        expect(puzzle.rating).toBeGreaterThanOrEqual(100);
        expect(puzzle.rating).toBeLessThanOrEqual(3000);
      });

      const mateTheme = puzzle.themes.find((theme) =>
        theme.startsWith("mateIn"),
      );

      if (mateTheme) {
        test(`${mateTheme}: the line ends in checkmate`, () => {
          expect(replay(puzzle.fen, puzzle.moves).status).toBe("checkmate");
        });

        test(`${mateTheme}: the solver plays that many moves`, () => {
          const expected = Number(mateTheme.slice("mateIn".length));
          expect(puzzle.moves).toHaveLength(expected * 2);
        });
      }
    });
  }
});
