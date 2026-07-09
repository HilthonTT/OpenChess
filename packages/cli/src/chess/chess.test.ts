import { describe, expect, test } from "bun:test";
import {
  STARTING_FEN,
  fromAlgebraic,
  parseFen,
  toAlgebraic,
  toFen,
} from "./board";
import {
  applyMove,
  generateLegalMoves,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { toSan } from "./san";
import {
  capturedPieces,
  createGame,
  findLegalMove,
  materialBalance,
  needsPromotion,
  play,
  undo,
} from "./game";
import type { Position, PromotionPiece } from "./types";

/** Count leaf nodes of the legal move tree — the standard move-generator check. */
function perft(position: Position, depth: number): number {
  if (depth === 0) {
    return 1;
  }

  const moves = generateLegalMoves(position);
  if (depth === 1) {
    return moves.length;
  }

  let nodes = 0;
  for (const move of moves) {
    nodes += perft(applyMove(position, move), depth - 1);
  }
  return nodes;
}

function square(name: string): number {
  const index = fromAlgebraic(name);
  if (index === null) {
    throw new Error(`bad square ${name}`);
  }
  return index;
}

/** Play a sequence of "e2e4" style moves, asserting each is legal. */
function playMoves(fen: string, moves: string[]) {
  let game = createGame(fen);
  for (const notation of moves) {
    const from = square(notation.slice(0, 2));
    const to = square(notation.slice(2, 4));
    const promotion = notation[4] as PromotionPiece | undefined;
    const move = findLegalMove(game, from, to, promotion);
    expect(move, `${notation} should be legal in ${toFen(game.position)}`).toBeDefined();
    game = play(game, move!);
  }
  return game;
}

describe("board", () => {
  test("square names round-trip", () => {
    expect(square("a8")).toBe(0);
    expect(square("h1")).toBe(63);
    expect(square("e4")).toBe(36);
    for (let i = 0; i < 64; i++) {
      expect(square(toAlgebraic(i))).toBe(i);
    }
  });

  test("FEN round-trips", () => {
    const fens = [
      STARTING_FEN,
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    ];
    for (const fen of fens) {
      expect(toFen(parseFen(fen))).toBe(fen);
    }
  });

  test("malformed FEN fields are rejected", () => {
    const board = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    expect(() => parseFen(`${board} w KQkq e9 0 1`)).toThrow(/en passant/);
    expect(() => parseFen(`${board} w KQkq - abc 1`)).toThrow(/halfmove/);
    expect(() => parseFen(`${board} w KQkq - 0 zero`)).toThrow(/fullmove/);
    expect(() => parseFen(`${board} w KQkq - -1 1`)).toThrow(/halfmove/);
    expect(() => parseFen(`${board} w KQkq - 0 0`)).toThrow(/fullmove/);
  });
});

describe("perft", () => {
  // Node counts from the Chess Programming Wiki's standard positions.
  const positions: Array<[string, string, number[]]> = [
    ["initial", STARTING_FEN, [20, 400, 8902, 197281]],
    [
      "kiwipete",
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      [48, 2039, 97862],
    ],
    ["endgame", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", [14, 191, 2812, 43238]],
    [
      "promotion traps",
      "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
      [6, 264, 9467],
    ],
    [
      "position 5",
      "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
      [44, 1486, 62379],
    ],
    [
      "position 6",
      "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
      [46, 2079],
    ],
  ];

  for (const [name, fen, expected] of positions) {
    test(name, () => {
      const position = parseFen(fen);
      expected.forEach((nodes, index) => {
        expect(perft(position, index + 1), `depth ${index + 1}`).toBe(nodes);
      });
    });
  }
});

describe("special moves", () => {
  test("en passant capture removes the passed pawn", () => {
    const game = playMoves(STARTING_FEN, ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
    expect(game.position.board[square("d5")]).toBe("");
    expect(game.position.board[square("d6")]).toBe("P");
  });

  test("en passant is only available immediately", () => {
    const game = playMoves(STARTING_FEN, ["e2e4", "a7a6", "e4e5", "d7d5", "a2a3", "a6a5"]);
    expect(findLegalMove(game, square("e5"), square("d6"))).toBeUndefined();
  });

  test("en passant that exposes the king is illegal", () => {
    // White king on e5, black rook on h5: taking f6 en passant would clear the rank.
    const game = createGame("8/8/8/K1Pp3r/8/8/8/7k w - d6 0 1");
    expect(findLegalMove(game, square("c5"), square("d6"))).toBeUndefined();
  });

  test("castling moves the rook and clears rights", () => {
    const game = playMoves(STARTING_FEN, ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "e1g1"]);
    expect(game.position.board[square("g1")]).toBe("K");
    expect(game.position.board[square("f1")]).toBe("R");
    expect(game.position.castling.whiteKingSide).toBe(false);
    expect(game.position.castling.whiteQueenSide).toBe(false);
  });

  test("cannot castle through, out of, or into check", () => {
    // Black rook on e8 attacks e1 — the king is in check.
    expect(
      findLegalMove(createGame("4r3/8/8/8/8/8/8/R3K2R w KQ - 0 1"), square("e1"), square("g1")),
    ).toBeUndefined();

    // Black rook on f8 attacks f1, which the king would cross.
    expect(
      findLegalMove(createGame("5r2/8/8/8/8/8/8/R3K2R w KQ - 0 1"), square("e1"), square("g1")),
    ).toBeUndefined();

    // Black rook on g8 attacks g1, the king's destination.
    expect(
      findLegalMove(createGame("6r1/8/8/8/8/8/8/R3K2R w KQ - 0 1"), square("e1"), square("g1")),
    ).toBeUndefined();

    // b1 attacked does not prevent queenside castling; the king never crosses it.
    expect(
      findLegalMove(createGame("1r6/8/8/8/8/8/8/R3K2R w KQ - 0 1"), square("e1"), square("c1")),
    ).toBeDefined();
  });

  test("capturing a rook on its home square removes castling rights", () => {
    const game = createGame("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const capture = findLegalMove(game, square("a1"), square("a8"));
    expect(capture).toBeDefined();
    const next = play(game, capture!);
    expect(next.position.castling.blackQueenSide).toBe(false);
    expect(next.position.castling.blackKingSide).toBe(true);
    expect(next.position.castling.whiteQueenSide).toBe(false);
  });

  test("promotion offers four pieces", () => {
    const game = createGame("8/P6k/8/8/8/8/8/K7 w - - 0 1");
    expect(needsPromotion(game, square("a7"), square("a8"))).toBe(true);

    const promotions = game.legalMoves
      .filter((move) => move.promotion !== null)
      .map((move) => move.promotion);
    expect(new Set(promotions)).toEqual(new Set(["q", "r", "b", "n"]));

    const knight = findLegalMove(game, square("a7"), square("a8"), "n");
    expect(play(game, knight!).position.board[square("a8")]).toBe("N");
  });

  test("a pinned piece cannot move", () => {
    // White knight on e2 is pinned to the king on e1 by the rook on e8.
    const game = createGame("4r2k/8/8/8/8/8/4N3/4K3 w - - 0 1");
    expect(game.legalMoves.filter((move) => move.from === square("e2"))).toHaveLength(0);
  });
});

describe("game results", () => {
  test("fool's mate is checkmate", () => {
    const game = playMoves(STARTING_FEN, ["f2f3", "e7e5", "g2g4", "d8h4"]);
    expect(game.status).toBe("checkmate");
    expect(isInCheck(game.position, "w")).toBe(true);
    expect(game.history[game.history.length - 1]?.san).toBe("Qh4#");
  });

  test("stalemate is detected", () => {
    const game = createGame("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(game.legalMoves).toHaveLength(0);
    expect(game.status).toBe("stalemate");
  });

  test("check is reported without ending the game", () => {
    const game = createGame("4k3/8/8/8/8/8/4R3/4K3 b - - 0 1");
    expect(game.status).toBe("check");
    expect(game.legalMoves.length).toBeGreaterThan(0);
  });

  test("insufficient material", () => {
    expect(isInsufficientMaterial(parseFen("8/8/4k3/8/8/4K3/8/8 w - - 0 1"))).toBe(true);
    expect(isInsufficientMaterial(parseFen("8/8/4k3/8/8/4K3/8/5B2 w - - 0 1"))).toBe(true);
    expect(isInsufficientMaterial(parseFen("8/8/4k3/8/8/4K3/8/5N2 w - - 0 1"))).toBe(true);
    // Bishops on the same square color (f8 and c1 are both light) can never mate.
    expect(isInsufficientMaterial(parseFen("5b2/8/4k3/8/8/4K3/8/2B5 w - - 0 1"))).toBe(true);
    // Opposite square colors (f8 light, f1 dark): mate is possible.
    expect(isInsufficientMaterial(parseFen("5b2/8/4k3/8/8/4K3/8/5B2 w - - 0 1"))).toBe(false);
    expect(isInsufficientMaterial(parseFen("8/8/4k3/8/8/4K3/8/5R2 w - - 0 1"))).toBe(false);
    expect(isInsufficientMaterial(parseFen("8/4p3/4k3/8/8/4K3/8/8 w - - 0 1"))).toBe(false);
  });

  test("fifty-move rule draws at 100 plies", () => {
    expect(createGame("4k3/8/8/8/8/8/4R3/4K3 w - - 99 60").status).toBe("playing");
    expect(createGame("4k3/8/8/8/8/8/4R3/4K3 w - - 100 60").status).toBe("draw-fifty-move");
  });

  test("threefold repetition draws", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    const game = playMoves(STARTING_FEN, [...shuffle, ...shuffle]);
    expect(game.status).toBe("draw-repetition");
  });

  test("undo restores the previous position", () => {
    const game = createGame();
    const opening = playMoves(STARTING_FEN, ["e2e4"]);
    expect(toFen(undo(opening).position)).toBe(toFen(game.position));
    expect(undo(game).history).toHaveLength(0);
  });

  test("illegal moves are rejected", () => {
    const game = createGame();
    expect(() =>
      play(game, {
        from: square("e2"),
        to: square("e5"),
        piece: "P",
        captured: null,
        promotion: null,
        isEnPassant: false,
        isCastle: null,
        isDoublePawnPush: false,
      }),
    ).toThrow(/Illegal move/);
  });
});

describe("captures and material", () => {
  test("captured pieces are tracked per side, most valuable first", () => {
    // 1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. Nb5 a6 5. Nxc7+ Qxc7
    const game = playMoves(STARTING_FEN, [
      "e2e4", "d7d5", "e4d5", "d8d5", "b1c3", "d5d8", "c3b5", "a7a6", "b5c7", "d8c7",
    ]);
    expect(capturedPieces(game).byWhite).toEqual(["p", "p"]);
    expect(capturedPieces(game).byBlack).toEqual(["N", "P"]);
  });

  test("en passant captures count the passed pawn", () => {
    const game = playMoves(STARTING_FEN, ["e2e4", "a7a6", "e4e5", "d7d5", "e5d6"]);
    expect(capturedPieces(game).byWhite).toEqual(["p"]);
  });

  test("undo removes the capture again", () => {
    const game = playMoves(STARTING_FEN, ["e2e4", "d7d5", "e4d5"]);
    expect(capturedPieces(undo(game)).byWhite).toEqual([]);
  });

  test("material balance counts the board, including promotions", () => {
    expect(materialBalance(parseFen(STARTING_FEN))).toBe(0);
    expect(materialBalance(parseFen("4k3/8/8/8/8/8/8/Q3K3 w - - 0 1"))).toBe(9);
    expect(materialBalance(parseFen("4k3/8/8/2n5/8/8/8/4K2R b - - 0 1"))).toBe(2);

    // A pawn promoting swings the balance by queen-minus-pawn.
    const promoted = playMoves("8/P6k/8/8/8/8/8/K7 w - - 0 1", ["a7a8q"]);
    expect(materialBalance(promoted.position)).toBe(9);
  });
});

describe("san", () => {
  function san(fen: string, from: string, to: string, promotion?: PromotionPiece) {
    const position = parseFen(fen);
    const moves = generateLegalMoves(position);
    const move = moves.find(
      (candidate) =>
        candidate.from === square(from) &&
        candidate.to === square(to) &&
        (promotion === undefined || candidate.promotion === promotion),
    );
    expect(move, `${from}${to} should be legal`).toBeDefined();
    return toSan(position, move!, moves);
  }

  test("pawn moves and captures", () => {
    expect(san(STARTING_FEN, "e2", "e4")).toBe("e4");
    expect(san("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "e4", "d5")).toBe("exd5");
  });

  test("piece moves, captures, and check", () => {
    expect(san(STARTING_FEN, "g1", "f3")).toBe("Nf3");
    expect(san("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1", "a1", "a8")).toBe("Ra8+");
  });

  test("castling", () => {
    expect(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "g1")).toBe("O-O");
    expect(san("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "c1")).toBe("O-O-O");
  });

  test("promotion and mate", () => {
    expect(san("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7", "a8", "n")).toBe("a8=N");
    expect(san("k7/7R/1K6/8/8/8/8/8 w - - 0 1", "h7", "h8")).toBe("Rh8#");
  });

  test("disambiguation by file, rank, and both", () => {
    // Knights on b1 and f3 both reach d2 — different files.
    expect(san("4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1", "b1", "d2")).toBe("Nbd2");
    // Rooks on a1 and a3 both reach a2 — same file, so rank disambiguates.
    expect(san("4k3/8/8/8/8/R7/8/R3K3 w - - 0 1", "a1", "a2")).toBe("R1a2");
    // Queens on a1, a4, and d1 all reach d4: a4 shares the a-file and d1 the
    // first rank, so neither alone identifies the mover.
    expect(san("8/8/7k/8/Q7/8/8/Q2QK3 w - - 0 1", "a1", "d4")).toBe("Qa1d4");
  });
});
