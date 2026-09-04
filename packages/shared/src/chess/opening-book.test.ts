import { describe, expect, test } from "bun:test";
import { createGame, play } from "./game";
import { findMove, generateLegalMoves } from "./moves";
import {
  bookMoves,
  chooseBookMove,
  namedOpening,
  openingBookStats,
  openingOf,
} from "./opening-book";
import { OPENING_LINES } from "./opening-lines";
import { playSan } from "./pgn";

function line(...sans: string[]) {
  let game = createGame();
  for (const san of sans) {
    game = playSan(game, san);
  }
  return game;
}

describe("the authored lines", () => {
  test("every line replays from the initial position", () => {
    expect(openingBookStats().skipped).toEqual([]);
  });

  test.each(OPENING_LINES.map((entry) => [entry.name, entry] as const))(
    "%s plays out",
    (_name, entry) => {
      let game = createGame();
      for (const san of entry.moves) {
        expect(() => {
          game = playSan(game, san);
        }).not.toThrow();
      }
      expect(game.history.length).toBe(entry.moves.length);
    },
  );

  test("every ECO code is a letter and two digits", () => {
    for (const entry of OPENING_LINES) {
      expect(entry.eco).toMatch(/^[A-E]\d{2}$/);
    }
  });

  test("no two lines play the same moves", () => {
    const seen = new Set<string>();
    for (const entry of OPENING_LINES) {
      const key = entry.moves.join(" ");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  test("lines that transpose agree on a name", () => {
    const byPosition = new Map<string, string>();

    for (const entry of OPENING_LINES) {
      let game = createGame();
      for (const san of entry.moves) {
        game = playSan(game, san);
      }

      const named = namedOpening(game.position);
      expect(named).not.toBeNull();

      const previous = byPosition.get(named!.name);
      if (previous !== undefined && previous !== entry.name) {
        throw new Error(
          `"${entry.name}" and "${previous}" reach the same position`,
        );
      }
      byPosition.set(named!.name, entry.name);
    }
  });

  test("weights are positive", () => {
    for (const entry of OPENING_LINES) {
      if (entry.weight !== undefined) {
        expect(entry.weight).toBeGreaterThan(0);
      }
    }
  });
});

describe("bookMoves", () => {
  test("offers the first moves it knows from the initial position", () => {
    const moves = bookMoves(createGame().position);
    const sans = moves.map((entry) => entry.san);

    expect(sans).toContain("e4");
    expect(sans).toContain("d4");
    expect(sans).toContain("Nf3");
    expect(sans).toContain("c4");
  });

  test("returns them most-played first, sharing out to one", () => {
    const moves = bookMoves(createGame().position);

    for (let i = 1; i < moves.length; i += 1) {
      expect(moves[i - 1]!.weight).toBeGreaterThanOrEqual(moves[i]!.weight);
    }

    const total = moves.reduce((sum, entry) => sum + entry.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  test("1.e4 outweighs every other first move", () => {
    const [best] = bookMoves(createGame().position);
    expect(best?.san).toBe("e4");
  });

  test("every move it offers is legal in the position", () => {
    const game = line("e4", "e5", "Nf3");

    for (const entry of bookMoves(game.position)) {
      const legal = findMove(
        game.legalMoves,
        entry.move.from,
        entry.move.to,
        entry.move.promotion ?? undefined,
      );
      expect(legal).toBeDefined();
    }
  });

  test("names what a continuation leads to", () => {
    const game = line("e4", "e5", "Nf3", "Nc6");
    const italian = bookMoves(game.position).find(
      (entry) => entry.san === "Bc4",
    );

    expect(italian?.leadsTo?.name).toBe("Italian Game");
    expect(italian?.leadsTo?.eco).toBe("C50");
  });

  test("runs dry once the game leaves the book", () => {
    expect(bookMoves(line("h4").position)).toEqual([]);
  });
});

describe("naming a position", () => {
  test("names the openings it knows", () => {
    expect(namedOpening(line("e4", "c5").position)?.name).toBe(
      "Sicilian Defence",
    );
    expect(namedOpening(line("e4", "e6").position)?.name).toBe(
      "French Defence",
    );
    expect(
      namedOpening(line("d4", "Nf6", "c4", "e6", "Nc3", "Bb4").position)?.name,
    ).toBe("Nimzo-Indian Defence");
  });

  test("names a position reached by a different move order", () => {
    const direct = line("e4", "e5", "Nf3", "Nc6", "Bc4");
    const transposed = line("e4", "e5", "Bc4", "Nc6", "Nf3");

    expect(namedOpening(direct.position)?.name).toBe("Italian Game");
    expect(namedOpening(transposed.position)?.name).toBe("Italian Game");
  });

  test("says nothing about a position it has never seen", () => {
    expect(namedOpening(line("a4", "h5").position)).toBeNull();
  });
});

describe("openingOf", () => {
  test("is null before a move is played", () => {
    expect(openingOf(createGame())).toBeNull();
  });

  test("reports the deepest opening the game passed through", () => {
    const game = line("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5");
    expect(openingOf(game)?.name).toBe("Italian Game: Giuoco Piano");
  });

  test("keeps the name after the game leaves the book", () => {
    // biome-ignore format: grouped in move pairs so the out-of-book comment lands in place
    const game = line(
      "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6",
      "h3", "h6", "a3", "g6",
    );

    expect(bookMoves(game.position)).toEqual([]);
    expect(openingOf(game)?.name).toBe("Sicilian Defence: Najdorf Variation");
    expect(openingOf(game)?.eco).toBe("B90");
  });

  test("names nothing for a game that never entered the book", () => {
    expect(openingOf(line("h4", "a5", "Rh3"))).toBeNull();
  });
});

describe("chooseBookMove", () => {
  test("returns a legal move of the position it was asked about", () => {
    const game = createGame();
    const move = chooseBookMove(game.position);

    expect(move).not.toBeNull();
    expect(game.legalMoves).toContainEqual(move!);
    expect(() => play(game, move!)).not.toThrow();
  });

  test("is null once the position is out of book", () => {
    expect(chooseBookMove(line("h4", "a5").position)).toBeNull();
  });

  test("picks by weight, so the ticket decides the move", () => {
    const position = createGame().position;
    const moves = bookMoves(position);

    const first = chooseBookMove(position, { random: () => 0 });
    expect(first?.from).toBe(moves[0]!.move.from);
    expect(first?.to).toBe(moves[0]!.move.to);

    const last = chooseBookMove(position, { random: () => 0.999999 });
    const lightest = moves[moves.length - 1]!;
    expect(last?.from).toBe(lightest.move.from);
    expect(last?.to).toBe(lightest.move.to);
  });

  test("varies across games rather than replaying one line", () => {
    const position = createGame().position;
    const seen = new Set<string>();

    for (let i = 0; i < 200; i += 1) {
      const move = chooseBookMove(position);
      seen.add(`${move!.from}-${move!.to}`);
    }

    expect(seen.size).toBeGreaterThan(1);
  });

  test("plays a whole game's worth of book without an illegal move", () => {
    for (let run = 0; run < 100; run += 1) {
      let game = createGame();

      for (let ply = 0; ply < 40; ply += 1) {
        const move = chooseBookMove(game.position);
        if (!move) {
          break;
        }
        expect(generateLegalMoves(game.position)).toContainEqual(move);
        game = play(game, move);
      }
    }
  });
});

describe("the built book", () => {
  test("holds every line's positions", () => {
    const stats = openingBookStats();

    expect(stats.lines).toBe(OPENING_LINES.length);
    expect(stats.positions).toBeGreaterThan(100);
    expect(stats.maxPlies).toBeGreaterThanOrEqual(16);
  });
});
