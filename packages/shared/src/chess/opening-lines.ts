/**
 * The built-in opening book, as named lines.
 *
 * A starter book, not a corpus: the openings a club player actually meets,
 * written as the move list that reaches them. `opening-book.ts` next door folds
 * these into a trie — one node per position, one edge per move — which is what
 * the engine picks its opening moves out of and what the explorer screen walks.
 *
 * Moves are SAN from the initial array; check and mate suffixes are optional,
 * since the book resolves each move against the position's own legal moves.
 * Every line is replayed through the engine by `opening-book.test.ts`, which
 * refuses one that does not play out — an authoring slip here would otherwise
 * reach players as a bot that has no move to make.
 *
 * `name` names the position the line *ends* on, so a line is also how a position
 * gets its label. Prefixes are named by their own entries: `Italian Game` is a
 * line in its own right, which is why `1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3` can
 * report Giuoco Piano while `3.Bc4` alone reports the Italian.
 *
 * `weight` is how often the book should steer into a line, relative to its
 * siblings, and it defaults to 1. It is added to *every* edge along the line
 * rather than to the last move alone, so a branch's pull is the sum of what runs
 * through it: a first move played by twenty lines outranks one played by two
 * without either needing a weight at all. The explicit weights here are only for
 * the top of the tree, where the number of lines below a move is a fact about
 * how much theory got written down rather than about how often it is played.
 *
 * ECO codes are the volume the line falls in. They are coarse by design — a
 * whole family shares one — so they are here to sort and label, not to identify.
 */

export type OpeningLine = {
  /** ECO code, e.g. `C50`. */
  eco: string;
  /** What the position at the end of `moves` is called. */
  name: string;
  /** The line in SAN, from the initial position. */
  moves: string[];
  /** Relative pull along the whole line; defaults to 1. */
  weight?: number;
};

export const OPENING_LINES: readonly OpeningLine[] = [
  // ── 1.e4 ────────────────────────────────────────────────────────────────
  { eco: "B00", name: "King's Pawn Opening", moves: ["e4"], weight: 10 },

  // 1.e4 e5 — the open games
  { eco: "C20", name: "Open Game", moves: ["e4", "e5"], weight: 4 },
  {
    eco: "C40",
    name: "King's Knight Opening",
    moves: ["e4", "e5", "Nf3"],
    weight: 3,
  },
  {
    eco: "C44",
    name: "King's Knight Opening: Normal Variation",
    moves: ["e4", "e5", "Nf3", "Nc6"],
    weight: 3,
  },

  // Ruy López
  {
    eco: "C60",
    name: "Ruy López",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
    weight: 4,
  },
  {
    eco: "C65",
    name: "Ruy López: Berlin Defence",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"],
    weight: 3,
  },
  {
    eco: "C67",
    name: "Ruy López: Berlin Defence, Open Variation",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6", "O-O", "Nxe4"],
    weight: 2,
  },
  {
    eco: "C70",
    name: "Ruy López: Morphy Defence",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"],
    weight: 3,
  },
  {
    eco: "C68",
    name: "Ruy López: Exchange Variation",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Bxc6", "dxc6"],
    weight: 2,
  },
  {
    eco: "C84",
    name: "Ruy López: Closed Defence",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"],
    weight: 2,
  },
  {
    eco: "C89",
    name: "Ruy López: Marshall Attack",
    moves: [
      "e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6",
      "O-O", "Be7", "Re1", "b5", "Bb3", "O-O", "c3", "d5",
    ],
  },

  // Italian
  {
    eco: "C50",
    name: "Italian Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    weight: 4,
  },
  {
    eco: "C50",
    name: "Italian Game: Giuoco Piano",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"],
    weight: 3,
  },
  {
    eco: "C53",
    name: "Italian Game: Giuoco Piano, Main Line",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3"],
    weight: 2,
  },
  {
    eco: "C51",
    name: "Italian Game: Evans Gambit",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "b4"],
  },
  {
    eco: "C55",
    name: "Italian Game: Two Knights Defence",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"],
    weight: 3,
  },
  {
    eco: "C57",
    name: "Two Knights Defence: Fried Liver Attack",
    moves: [
      "e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6",
      "Ng5", "d5", "exd5", "Nxd5", "Nxf7",
    ],
  },
  {
    eco: "C58",
    name: "Two Knights Defence: Polerio Defence",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Na5"],
  },
  {
    eco: "C50",
    name: "Italian Game: Hungarian Defence",
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4", "Be7"],
  },

  // Scotch and friends
  {
    eco: "C44",
    name: "Scotch Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "d4"],
    weight: 3,
  },
  {
    eco: "C45",
    name: "Scotch Game: Classical Variation",
    moves: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4", "Bc5"],
    weight: 2,
  },
  {
    eco: "C44",
    name: "Scotch Gambit",
    moves: ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Bc4"],
  },
  {
    eco: "C44",
    name: "Ponziani Opening",
    moves: ["e4", "e5", "Nf3", "Nc6", "c3"],
  },

  // Knight games
  {
    eco: "C46",
    name: "Three Knights Opening",
    moves: ["e4", "e5", "Nf3", "Nc6", "Nc3"],
  },
  {
    eco: "C47",
    name: "Four Knights Game",
    moves: ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6"],
    weight: 2,
  },
  {
    eco: "C48",
    name: "Four Knights Game: Spanish Variation",
    moves: ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6", "Bb5"],
  },
  {
    eco: "C49",
    name: "Four Knights Game: Double Spanish",
    moves: ["e4", "e5", "Nf3", "Nc6", "Nc3", "Nf6", "Bb5", "Bb4"],
  },

  // Second-move alternatives for black
  {
    eco: "C42",
    name: "Petrov's Defence",
    moves: ["e4", "e5", "Nf3", "Nf6"],
    weight: 2,
  },
  { eco: "C41", name: "Philidor Defence", moves: ["e4", "e5", "Nf3", "d6"] },
  { eco: "C40", name: "Latvian Gambit", moves: ["e4", "e5", "Nf3", "f5"] },
  { eco: "C40", name: "Elephant Gambit", moves: ["e4", "e5", "Nf3", "d5"] },

  // Second-move alternatives for white
  {
    eco: "C30",
    name: "King's Gambit",
    moves: ["e4", "e5", "f4"],
    weight: 2,
  },
  {
    eco: "C33",
    name: "King's Gambit Accepted",
    moves: ["e4", "e5", "f4", "exf4"],
  },
  {
    eco: "C31",
    name: "King's Gambit Declined: Falkbeer Countergambit",
    moves: ["e4", "e5", "f4", "d5"],
  },
  { eco: "C25", name: "Vienna Game", moves: ["e4", "e5", "Nc3"], weight: 2 },
  {
    eco: "C29",
    name: "Vienna Gambit",
    moves: ["e4", "e5", "Nc3", "Nf6", "f4"],
  },
  { eco: "C23", name: "Bishop's Opening", moves: ["e4", "e5", "Bc4"] },
  { eco: "C21", name: "Centre Game", moves: ["e4", "e5", "d4"] },
  {
    eco: "C22",
    name: "Centre Game Accepted",
    moves: ["e4", "e5", "d4", "exd4", "Qxd4"],
  },
  {
    eco: "C21",
    name: "Danish Gambit",
    moves: ["e4", "e5", "d4", "exd4", "c3"],
  },

  // Sicilian
  { eco: "B20", name: "Sicilian Defence", moves: ["e4", "c5"], weight: 6 },
  {
    eco: "B27",
    name: "Sicilian Defence: Main Line",
    moves: ["e4", "c5", "Nf3"],
    weight: 4,
  },
  {
    eco: "B50",
    name: "Sicilian Defence: Modern Variations",
    moves: ["e4", "c5", "Nf3", "d6"],
    weight: 3,
  },
  {
    eco: "B40",
    name: "Sicilian Defence: French Variation",
    moves: ["e4", "c5", "Nf3", "e6"],
    weight: 2,
  },
  {
    eco: "B30",
    name: "Sicilian Defence: Old Sicilian",
    moves: ["e4", "c5", "Nf3", "Nc6"],
    weight: 2,
  },
  {
    eco: "B90",
    name: "Sicilian Defence: Najdorf Variation",
    moves: [
      "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6",
    ],
    weight: 3,
  },
  {
    eco: "B70",
    name: "Sicilian Defence: Dragon Variation",
    moves: [
      "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "g6",
    ],
    weight: 2,
  },
  {
    eco: "B80",
    name: "Sicilian Defence: Scheveningen Variation",
    moves: [
      "e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e6",
    ],
  },
  {
    eco: "B60",
    name: "Sicilian Defence: Richter-Rauzer Attack",
    moves: [
      "e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "d6", "Bg5",
    ],
  },
  {
    eco: "B33",
    name: "Sicilian Defence: Sveshnikov Variation",
    moves: [
      "e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "e5",
    ],
  },
  {
    eco: "B22",
    name: "Sicilian Defence: Alapin Variation",
    moves: ["e4", "c5", "c3"],
    weight: 2,
  },
  { eco: "B23", name: "Sicilian Defence: Closed", moves: ["e4", "c5", "Nc3"] },
  {
    eco: "B21",
    name: "Sicilian Defence: Smith-Morra Gambit",
    moves: ["e4", "c5", "d4", "cxd4", "c3"],
  },

  // French
  { eco: "C00", name: "French Defence", moves: ["e4", "e6"], weight: 4 },
  {
    eco: "C02",
    name: "French Defence: Advance Variation",
    moves: ["e4", "e6", "d4", "d5", "e5"],
    weight: 2,
  },
  {
    eco: "C01",
    name: "French Defence: Exchange Variation",
    moves: ["e4", "e6", "d4", "d5", "exd5", "exd5"],
  },
  {
    eco: "C03",
    name: "French Defence: Tarrasch Variation",
    moves: ["e4", "e6", "d4", "d5", "Nd2"],
    weight: 2,
  },
  {
    eco: "C10",
    name: "French Defence: Paulsen Variation",
    moves: ["e4", "e6", "d4", "d5", "Nc3"],
    weight: 2,
  },
  {
    eco: "C11",
    name: "French Defence: Classical Variation",
    moves: ["e4", "e6", "d4", "d5", "Nc3", "Nf6"],
  },
  {
    eco: "C15",
    name: "French Defence: Winawer Variation",
    moves: ["e4", "e6", "d4", "d5", "Nc3", "Bb4"],
    weight: 2,
  },

  // Caro-Kann
  { eco: "B10", name: "Caro-Kann Defence", moves: ["e4", "c6"], weight: 3 },
  {
    eco: "B12",
    name: "Caro-Kann Defence: Advance Variation",
    moves: ["e4", "c6", "d4", "d5", "e5"],
    weight: 2,
  },
  {
    eco: "B13",
    name: "Caro-Kann Defence: Exchange Variation",
    moves: ["e4", "c6", "d4", "d5", "exd5", "cxd5"],
  },
  {
    eco: "B15",
    name: "Caro-Kann Defence: Main Line",
    moves: ["e4", "c6", "d4", "d5", "Nc3"],
    weight: 2,
  },
  {
    eco: "B18",
    name: "Caro-Kann Defence: Classical Variation",
    moves: ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Bf5"],
  },
  {
    eco: "B17",
    name: "Caro-Kann Defence: Steinitz Variation",
    moves: ["e4", "c6", "d4", "d5", "Nc3", "dxe4", "Nxe4", "Nd7"],
  },
  {
    eco: "B10",
    name: "Caro-Kann Defence: Two Knights Attack",
    moves: ["e4", "c6", "Nc3", "d5", "Nf3"],
  },

  // The rest of 1.e4
  { eco: "B01", name: "Scandinavian Defence", moves: ["e4", "d5"], weight: 2 },
  {
    eco: "B01",
    name: "Scandinavian Defence: Main Line",
    moves: ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5"],
  },
  { eco: "B02", name: "Alekhine's Defence", moves: ["e4", "Nf6"] },
  { eco: "B06", name: "Modern Defence", moves: ["e4", "g6"] },
  {
    eco: "B07",
    name: "Pirc Defence",
    moves: ["e4", "d6", "d4", "Nf6", "Nc3"],
  },
  { eco: "B00", name: "Nimzowitsch Defence", moves: ["e4", "Nc6"] },
  { eco: "B00", name: "Owen's Defence", moves: ["e4", "b6"] },

  // ── 1.d4 ────────────────────────────────────────────────────────────────
  { eco: "A40", name: "Queen's Pawn Opening", moves: ["d4"], weight: 9 },

  // 1.d4 d5
  { eco: "D00", name: "Queen's Pawn Game", moves: ["d4", "d5"], weight: 4 },
  { eco: "D06", name: "Queen's Gambit", moves: ["d4", "d5", "c4"], weight: 4 },
  {
    eco: "D20",
    name: "Queen's Gambit Accepted",
    moves: ["d4", "d5", "c4", "dxc4"],
    weight: 2,
  },
  {
    eco: "D30",
    name: "Queen's Gambit Declined",
    moves: ["d4", "d5", "c4", "e6"],
    weight: 3,
  },
  {
    eco: "D35",
    name: "Queen's Gambit Declined: Exchange Variation",
    moves: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "cxd5", "exd5"],
  },
  {
    eco: "D37",
    name: "Queen's Gambit Declined: Three Knights Variation",
    moves: ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Nf3", "Be7"],
  },
  { eco: "D10", name: "Slav Defence", moves: ["d4", "d5", "c4", "c6"], weight: 3 },
  {
    eco: "D43",
    name: "Semi-Slav Defence",
    moves: ["d4", "d5", "c4", "c6", "Nf3", "Nf6", "Nc3", "e6"],
  },
  { eco: "D07", name: "Chigorin Defence", moves: ["d4", "d5", "c4", "Nc6"] },
  {
    eco: "D02",
    name: "London System",
    moves: ["d4", "d5", "Nf3", "Nf6", "Bf4"],
    weight: 2,
  },
  {
    eco: "D05",
    name: "Colle System",
    moves: ["d4", "d5", "Nf3", "Nf6", "e3"],
  },

  // 1.d4 Nf6 — the Indian defences
  { eco: "A45", name: "Indian Defence", moves: ["d4", "Nf6"], weight: 5 },
  { eco: "A45", name: "Trompowsky Attack", moves: ["d4", "Nf6", "Bg5"] },
  {
    eco: "A46",
    name: "Indian Defence: Knights Variation",
    moves: ["d4", "Nf6", "Nf3"],
    weight: 2,
  },
  {
    eco: "E00",
    name: "Indian Defence: Queen's Pawn Game",
    moves: ["d4", "Nf6", "c4"],
    weight: 4,
  },
  {
    eco: "E00",
    name: "Indian Defence: East Indian",
    moves: ["d4", "Nf6", "c4", "e6"],
    weight: 3,
  },
  {
    eco: "E20",
    name: "Nimzo-Indian Defence",
    moves: ["d4", "Nf6", "c4", "e6", "Nc3", "Bb4"],
    weight: 3,
  },
  {
    eco: "E12",
    name: "Queen's Indian Defence",
    moves: ["d4", "Nf6", "c4", "e6", "Nf3", "b6"],
    weight: 2,
  },
  {
    eco: "E60",
    name: "King's Indian Defence",
    moves: ["d4", "Nf6", "c4", "g6"],
    weight: 3,
  },
  {
    eco: "E61",
    name: "King's Indian Defence: Normal Variation",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"],
    weight: 2,
  },
  {
    eco: "D80",
    name: "Grünfeld Defence",
    moves: ["d4", "Nf6", "c4", "g6", "Nc3", "d5"],
    weight: 2,
  },
  { eco: "A56", name: "Benoni Defence", moves: ["d4", "Nf6", "c4", "c5"] },
  {
    eco: "A57",
    name: "Benko Gambit",
    moves: ["d4", "Nf6", "c4", "c5", "d5", "b5"],
  },

  // The rest of 1.d4
  { eco: "A80", name: "Dutch Defence", moves: ["d4", "f5"] },
  { eco: "A40", name: "Queen's Pawn: Modern Defence", moves: ["d4", "g6"] },

  // ── Flank openings ──────────────────────────────────────────────────────
  { eco: "A04", name: "Réti Opening", moves: ["Nf3"], weight: 3 },
  {
    eco: "A09",
    name: "Réti Opening: Main Line",
    moves: ["Nf3", "d5", "c4"],
  },
  { eco: "A07", name: "King's Indian Attack", moves: ["Nf3", "d5", "g3"] },
  { eco: "A10", name: "English Opening", moves: ["c4"], weight: 3 },
  {
    eco: "A20",
    name: "English Opening: King's English",
    moves: ["c4", "e5"],
  },
  {
    eco: "A30",
    name: "English Opening: Symmetrical Variation",
    moves: ["c4", "c5"],
  },
  {
    eco: "A15",
    name: "English Opening: Anglo-Indian Defence",
    moves: ["c4", "Nf6"],
  },
  {
    eco: "A16",
    name: "English Opening: Anglo-Grünfeld Defence",
    moves: ["c4", "Nf6", "Nc3", "d5"],
  },
  { eco: "A01", name: "Nimzo-Larsen Attack", moves: ["b3"] },
  { eco: "A02", name: "Bird's Opening", moves: ["f4"] },
  { eco: "A00", name: "Van Geet Opening", moves: ["Nc3"] },
];
