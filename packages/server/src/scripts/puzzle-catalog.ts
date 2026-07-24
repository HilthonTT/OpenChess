/**
 * The built-in puzzle catalog.
 *
 * A starter set, not a corpus: a dozen hand-authored positions covering the
 * mating patterns and the one-move tactics a new player meets first, so a
 * freshly seeded database has something to serve. The real supply is the
 * Lichess puzzle database — `import-puzzles.ts` next door loads it, and every
 * row it writes lands in the same table with the same shape.
 *
 * Format is the one `chess/puzzle.ts` documents: `fen` is the position *before*
 * the mistake, `moves[0]` is the mistake, and the solver plays the odd indices
 * from there. Every entry is checked against the engine by
 * `puzzle-catalog.test.ts`, which refuses a line that does not replay and
 * refuses a `mateIn*` theme whose line does not actually mate — an authoring
 * slip here would otherwise reach players as an unsolvable puzzle.
 */

export type CatalogPuzzle = {
  /** Stable key. `openchess:` namespaced so it can never collide with an import. */
  externalId: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
};

export const PUZZLE_CATALOG: CatalogPuzzle[] = [
  {
    externalId: "openchess:ladder-mate-basic",
    fen: "6k1/7p/6K1/8/8/8/8/R7 b - - 0 1",
    moves: ["h7h6", "a1a8"],
    rating: 500,
    themes: ["mateIn1", "endgame", "rookMate"],
  },
  {
    externalId: "openchess:fools-mate",
    fen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2",
    moves: ["g2g4", "d8h4"],
    rating: 600,
    themes: ["mateIn1", "opening", "short"],
  },
  {
    externalId: "openchess:back-rank-rook",
    fen: "6k1/3p1ppp/8/8/8/8/1R6/R5K1 b - - 0 1",
    moves: ["d7d6", "a1a8"],
    rating: 700,
    themes: ["mateIn1", "backRankMate", "endgame"],
  },
  {
    externalId: "openchess:back-rank-queen",
    fen: "6k1/p4ppp/8/8/8/8/8/3Q2K1 b - - 0 1",
    moves: ["a7a6", "d1d8"],
    rating: 800,
    themes: ["mateIn1", "backRankMate", "queenMate"],
  },
  {
    externalId: "openchess:promotion-mate",
    fen: "7k/p1P3pp/8/8/8/8/8/6K1 b - - 0 1",
    moves: ["a7a6", "c7c8q"],
    rating: 900,
    themes: ["mateIn1", "promotion", "advancedPawn"],
  },
  {
    externalId: "openchess:smothered-knight",
    fen: "6rk/p5pp/8/6N1/8/8/8/6K1 b - - 0 1",
    moves: ["a7a6", "g5f7"],
    rating: 1000,
    themes: ["mateIn1", "smotheredMate", "knightMate"],
  },
  {
    externalId: "openchess:smothered-knight-black",
    fen: "6k1/8/8/8/6n1/8/P5PP/6RK w - - 0 1",
    moves: ["a2a3", "g4f2"],
    rating: 1000,
    themes: ["mateIn1", "smotheredMate", "knightMate"],
  },
  {
    externalId: "openchess:arabian-mate",
    fen: "7k/p2R4/5N2/8/8/8/8/6K1 b - - 0 1",
    moves: ["a7a6", "d7h7"],
    rating: 1100,
    themes: ["mateIn1", "arabianMate", "endgame"],
  },
  {
    externalId: "openchess:back-rank-queen-black",
    fen: "3q2k1/5ppp/8/8/8/8/P4PPP/6K1 w - - 0 1",
    moves: ["a2a3", "d8d1"],
    rating: 800,
    themes: ["mateIn1", "backRankMate", "queenMate"],
  },
  {
    externalId: "openchess:bishop-battery-h7",
    fen: "5rk1/p4ppp/8/7Q/8/3B4/8/6K1 b - - 0 1",
    moves: ["a7a6", "h5h7"],
    rating: 1200,
    themes: ["mateIn1", "kingsideAttack", "sacrifice"],
  },
  {
    externalId: "openchess:knight-fork-queen",
    fen: "3q3k/p5pp/8/4N3/8/8/8/6K1 b - - 0 1",
    moves: ["a7a6", "e5f7", "h8g8", "f7d8"],
    rating: 1250,
    themes: ["fork", "knightFork", "royalFork"],
  },
  {
    externalId: "openchess:ladder-mate-doubled",
    fen: "3r2k1/1p3ppp/8/8/8/8/R7/R5K1 b - - 0 1",
    moves: ["b7b6", "a2a8", "d8a8", "a1a8"],
    rating: 1350,
    themes: ["mateIn2", "backRankMate", "sacrifice"],
  },
  {
    externalId: "openchess:deflection-back-rank",
    fen: "2rr2k1/p4ppp/8/Q7/8/8/8/3R2K1 b - - 0 1",
    moves: ["a7a6", "d1d8", "c8d8", "a5d8"],
    rating: 1450,
    themes: ["mateIn2", "backRankMate", "deflection", "sacrifice"],
  },
];
