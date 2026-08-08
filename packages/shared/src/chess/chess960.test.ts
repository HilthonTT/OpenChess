import { describe, expect, test } from "bun:test";
import {
  FILES,
  STARTING_FEN,
  emptyBoard,
  fromAlgebraic,
  isStandardCastlingSetup,
  parseFen,
  squareAt,
  toAlgebraic,
  toFen,
} from "./board";
import {
  CHESS960_POSITIONS,
  STANDARD_CHESS960_INDEX,
  castlingFilesFor,
  chess960BackRank,
  chess960Fen,
  randomChess960Index,
} from "./chess960";
import { createGame, play, undo } from "./game";
import { applyMove, generateLegalMoves } from "./moves";
import { findUciMove, toUci } from "./pgn";
import { toSan } from "./san";
import type { PieceType, Position } from "./types";

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

/** The back rank of a position, as piece letters from the a-file. */
function backRankOf(position: Position, rank: number): string {
  let text = "";
  for (let file = 0; file < 8; file += 1) {
    text += position.board[squareAt(file, rank)] || ".";
  }
  return text;
}

const ALL = Array.from({ length: CHESS960_POSITIONS }, (_, index) => index);

describe("the numbering", () => {
  test("#518 is the ordinary game, down to the FEN", () => {
    expect(chess960Fen(STANDARD_CHESS960_INDEX)).toBe(STARTING_FEN);
    expect(chess960BackRank(STANDARD_CHESS960_INDEX).join("")).toBe("rnbqkbnr");
  });

  test("rejects an array that does not exist", () => {
    expect(() => chess960Fen(-1)).toThrow();
    expect(() => chess960Fen(CHESS960_POSITIONS)).toThrow();
    expect(() => chess960Fen(1.5)).toThrow();
  });

  test("every array holds one of each piece, and the right number of them", () => {
    for (const index of ALL) {
      const counts = new Map<PieceType, number>();
      for (const piece of chess960BackRank(index)) {
        counts.set(piece, (counts.get(piece) ?? 0) + 1);
      }

      expect(counts.get("k"), `#${index}`).toBe(1);
      expect(counts.get("q"), `#${index}`).toBe(1);
      expect(counts.get("r"), `#${index}`).toBe(2);
      expect(counts.get("b"), `#${index}`).toBe(2);
      expect(counts.get("n"), `#${index}`).toBe(2);
    }
  });

  test("the bishops always land on opposite colours", () => {
    for (const index of ALL) {
      const rank = chess960BackRank(index);
      const bishops = rank.flatMap((piece, file) =>
        piece === "b" ? [file] : [],
      );

      expect(bishops.length, `#${index}`).toBe(2);
      expect(bishops[0]! % 2, `#${index}`).not.toBe(bishops[1]! % 2);
    }
  });

  test("the king always stands between the two rooks", () => {
    for (const index of ALL) {
      const rank = chess960BackRank(index);
      const king = rank.indexOf("k");

      expect(rank.indexOf("r"), `#${index}`).toBeLessThan(king);
      expect(rank.lastIndexOf("r"), `#${index}`).toBeGreaterThan(king);
    }
  });

  test("no two numbers name the same array", () => {
    const seen = new Set(ALL.map((index) => chess960BackRank(index).join("")));
    expect(seen.size).toBe(CHESS960_POSITIONS);
  });

  test("a random index is always a real one", () => {
    expect(randomChess960Index(() => 0)).toBe(0);
    expect(randomChess960Index(() => 0.9999999)).toBe(CHESS960_POSITIONS - 1);
  });
});

describe("the opening FEN", () => {
  test("mirrors the armies and fills both pawn ranks", () => {
    for (const index of ALL) {
      const position = parseFen(chess960Fen(index));
      const white = backRankOf(position, 0);
      const black = backRankOf(position, 7);

      expect(white, `#${index}`).toBe(black.toUpperCase());
      expect(backRankOf(position, 1), `#${index}`).toBe("PPPPPPPP");
      expect(backRankOf(position, 6), `#${index}`).toBe("pppppppp");
    }
  });

  test("round-trips through parse and write, byte for byte", () => {
    for (const index of ALL) {
      const fen = chess960Fen(index);
      expect(toFen(parseFen(fen)), `#${index}`).toBe(fen);
    }
  });

  test("names the rooks' files, unless they are already a and h", () => {
    for (const index of ALL) {
      const field = chess960Fen(index).split(" ")[2]!;
      const rank = chess960BackRank(index);

      // `KQkq` is written whenever it can only mean one thing — which is any
      // array whose king and rooks happen to sit on e, a and h, not only the
      // ordinary one. Everything else names the files outright.
      if (
        rank.indexOf("k") === 4 &&
        rank.indexOf("r") === 0 &&
        rank.lastIndexOf("r") === 7
      ) {
        expect(field, `#${index}`).toBe("KQkq");
        continue;
      }

      const queenRook = FILES[rank.indexOf("r")]!;
      const kingRook = FILES[rank.lastIndexOf("r")]!;

      expect(field, `#${index}`).toBe(
        `${kingRook.toUpperCase()}${queenRook.toUpperCase()}${kingRook}${queenRook}`,
      );
    }
  });

  test("the ordinary array searches to the same perft it always did", () => {
    const position = parseFen(chess960Fen(STANDARD_CHESS960_INDEX));

    expect(perft(position, 1)).toBe(20);
    expect(perft(position, 2)).toBe(400);
    expect(perft(position, 3)).toBe(8902);
    expect(perft(position, 4)).toBe(197281);
  });
});

/**
 * Castling is the whole of what Chess960 changes, and the interesting cases are
 * the ones a normal array can never produce: a king that castles without moving
 * at all, a rook that lands on the square the king just left, and a king that
 * travels *left* to castle king-side. Rather than hand-pick the arrays that do
 * that, this runs all 960 of them.
 *
 * The board is cleared down to the one king and the one rook being tested.
 * Two things make that necessary rather than merely convenient. Leaving both of
 * a side's rooks on the rank would not do: in an array like `bbqnnrkr` the
 * queen-side rook stands on f1, which is where the king-side rook has to land,
 * so that castle is genuinely — and correctly — unavailable. Nor can the enemy
 * army be mirrored onto the far rank, because in that same array black's rook
 * would sit on f8 covering f1, a square white's king crosses on its way to c1,
 * which forbids the castle just as correctly. Both are real rules; neither is
 * what this test is asking about.
 */
describe("castling from a shuffled array", () => {
  /** One king and one rook, alone on the board, entitled to castle. */
  function bareCastlingPosition(
    index: number,
    side: "king" | "queen",
    turn: "w" | "b" = "w",
  ): Position {
    const rank = chess960BackRank(index);
    const files = castlingFilesFor(rank)[turn];
    const rookFile = side === "king" ? files.kingRook : files.queenRook;
    const home = turn === "w" ? 0 : 7;
    const board = emptyBoard();

    for (const [file, piece] of [
      [files.king, "k"],
      [rookFile, "r"],
    ] as const) {
      board[squareAt(file, home)] =
        turn === "w" ? (piece.toUpperCase() as never) : piece;
    }

    return {
      board,
      turn,
      castling: {
        whiteKingSide: true,
        whiteQueenSide: true,
        blackKingSide: true,
        blackQueenSide: true,
      },
      castlingFiles: castlingFilesFor(rank),
      enPassant: null,
      halfmoveClock: 0,
      fullmoveNumber: 1,
    };
  }

  const SIDES = ["king", "queen"] as const;

  test("the castle is always available, and lands on g/f or c/d", () => {
    for (const index of ALL) {
      for (const side of SIDES) {
        const position = bareCastlingPosition(index, side);
        const castles = generateLegalMoves(position).filter(
          (move) => move.isCastle !== null,
        );
        const label = `#${index} ${side}`;

        expect(castles.length, label).toBe(1);
        expect(castles[0]!.isCastle, label).toBe(side);

        const after = applyMove(position, castles[0]!);
        expect(after.board[square(side === "king" ? "g1" : "c1")], label).toBe(
          "K",
        );
        expect(after.board[square(side === "king" ? "f1" : "d1")], label).toBe(
          "R",
        );

        // And nothing is left behind. A king or rook duplicated onto its own
        // origin is exactly the bug that overlapping squares invite.
        const rank = backRankOf(after, 0).replace(/\./g, "");
        expect(rank.split("").sort().join(""), label).toBe("KR");
      }
    }
  });

  test("black castles onto its own back rank", () => {
    for (const index of ALL) {
      for (const side of SIDES) {
        const position = bareCastlingPosition(index, side, "b");
        const castle = generateLegalMoves(position).find((m) => m.isCastle);
        expect(castle, `#${index} ${side}`).toBeDefined();

        const after = applyMove(position, castle!);
        expect(after.board[square(side === "king" ? "g8" : "c8")]).toBe("k");
        expect(after.board[square(side === "king" ? "f8" : "d8")]).toBe("r");
      }
    }
  });

  test("castling always spends both of that side's rights", () => {
    for (const index of ALL) {
      for (const side of SIDES) {
        const position = bareCastlingPosition(index, side);
        const castle = generateLegalMoves(position).find((m) => m.isCastle)!;
        const after = applyMove(position, castle);

        expect(after.castling.whiteKingSide, `#${index}`).toBe(false);
        expect(after.castling.whiteQueenSide, `#${index}`).toBe(false);
        // The opponent's are untouched by it — even when the mover's rook
        // happens to pass over the file the opponent's rook started on.
        expect(after.castling.blackKingSide, `#${index}`).toBe(true);
        expect(after.castling.blackQueenSide, `#${index}`).toBe(true);
      }
    }
  });

  test("still reads as O-O and O-O-O", () => {
    for (const index of ALL) {
      for (const side of SIDES) {
        const position = bareCastlingPosition(index, side);
        const legal = generateLegalMoves(position);
        const castle = legal.find((m) => m.isCastle)!;

        // A bare rank means a castle often gives check; that decoration is not
        // what is being asked about here.
        expect(
          toSan(position, castle, legal).replace(/[+#]$/, ""),
          `#${index}`,
        ).toBe(side === "king" ? "O-O" : "O-O-O");
      }
    }
  });
});

describe("castling is written king-takes-rook", () => {
  test("but only when the array is shuffled", () => {
    const standard = createGame("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const castles = standard.legalMoves.filter((move) => move.isCastle);

    expect(castles.map(toUci).sort()).toEqual(["e1c1", "e1g1"]);
  });

  test("a shuffled game names the rook's square", () => {
    // King on g1, rooks on b1 and h1: both castles are open, and each is
    // written as the king taking its own rook.
    const game = createGame("1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const castles = game.legalMoves.filter((move) => move.isCastle);

    expect(castles.map(toUci).sort()).toEqual(["g1b1", "g1h1"]);
  });

  test("a king that castles without moving is still a castle", () => {
    // King already on g1 with the rook on h1: `kingTo` is where it stands.
    const game = createGame("1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const move = findUciMove(game, "g1h1");

    expect(move?.isCastle).toBe("king");

    const after = play(game, move!);
    expect(after.position.board[square("g1")]).toBe("K");
    expect(after.position.board[square("f1")]).toBe("R");
    expect(after.position.board[square("h1")]).toBe("");
  });

  test("a rook that lands on the square the king left", () => {
    // King on d1, queen-side rook on a1: the king goes d1 -> c1 and the rook
    // a1 -> d1, straight onto the square the king vacated.
    const game = createGame("r2k3r/8/8/8/8/8/8/R2K3R w HAha - 0 1");
    const move = findUciMove(game, "d1a1");

    expect(move?.isCastle).toBe("queen");

    const after = play(game, move!);
    expect(after.position.board[square("c1")]).toBe("K");
    expect(after.position.board[square("d1")]).toBe("R");
    expect(after.position.board[square("a1")]).toBe("");
  });
});

describe("the rules castling still has to obey", () => {
  test("not out of check", () => {
    const game = createGame("1r4kr/6q1/8/8/8/8/8/1R4KR w HBhb - 0 1");
    expect(game.legalMoves.some((move) => move.isCastle)).toBe(false);
  });

  test("not through an attacked square", () => {
    // The king walks b1 -> c1 castling queen-side; a rook on c8 covers c1.
    const game = createGame("2r5/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const queenSide = game.legalMoves.find((move) => move.isCastle === "queen");
    expect(queenSide).toBeUndefined();
  });

  test("not with a piece in the rook's way", () => {
    // Everything is clear for the king (g1 stays put, f1 is empty) but the
    // queen-side rook on b1 has to reach d1, and c1 is occupied.
    const game = createGame("1r4kr/8/8/8/8/8/8/1RN3KR w HBhb - 0 1");
    const sides = game.legalMoves
      .filter((move) => move.isCastle)
      .map((move) => move.isCastle);

    expect(sides).toEqual(["king"]);
  });

  test("a b-file square the king never crosses may be attacked", () => {
    // Queen-side castling from a king on d1: the rook crosses b1 and the king
    // does not, so a rook bearing down the b-file does not forbid it — exactly
    // as b1 does not in an ordinary game.
    const game = createGame("1r6/8/8/8/8/8/8/R2K3R w HAha - 0 1");
    const queenSide = game.legalMoves.find((move) => move.isCastle === "queen");

    expect(queenSide).toBeDefined();
  });

  test("moving the king-side rook spends only that right", () => {
    const game = createGame("1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const after = play(game, findUciMove(game, "h1h4")!);

    expect(after.position.castling.whiteKingSide).toBe(false);
    expect(after.position.castling.whiteQueenSide).toBe(true);
  });

  test("capturing a rook on its home square spends the owner's right", () => {
    const game = createGame("1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const after = play(game, findUciMove(game, "b1b8")!);

    expect(after.position.castling.blackQueenSide).toBe(false);
    expect(after.position.castling.blackKingSide).toBe(true);
  });
});

describe("the castling setup a FEN carries", () => {
  test("an ordinary FEN reads as the ordinary setup", () => {
    expect(isStandardCastlingSetup(parseFen(STARTING_FEN).castlingFiles)).toBe(
      true,
    );
  });

  test("KQkq on a shuffled array means the outermost rooks", () => {
    // Same array written both ways: `KQkq` has to resolve to the same files the
    // Shredder spelling names outright.
    const shredder = parseFen(
      "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w HFhf - 0 1",
    );
    const plain = parseFen(
      "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w KQkq - 0 1",
    );

    expect(plain.castlingFiles).toEqual(shredder.castlingFiles);
    expect(plain.castlingFiles.w).toEqual({
      king: 6,
      queenRook: 5,
      kingRook: 7,
    });
  });

  test("a FEN with no rights still parses, and castles nowhere", () => {
    const game = createGame(
      "bbqnnrkr/pppppppp/8/8/8/8/PPPPPPPP/BBQNNRKR w - - 0 1",
    );
    expect(game.legalMoves.some((move) => move.isCastle)).toBe(false);
    expect(toFen(game.position).split(" ")[2]).toBe("-");
  });

  test("the files survive every move of a game", () => {
    let game = createGame(chess960Fen(0));
    const start = game.position.castlingFiles;

    for (const uci of ["e2e4", "e7e5", "d2d4", "d7d5"]) {
      game = play(game, findUciMove(game, uci)!);
    }

    expect(game.position.castlingFiles).toEqual(start);
  });
});

describe("a whole shuffled game", () => {
  test("plays, records and replays", () => {
    const fen = "1r4kr/pppppppp/8/8/8/8/PPPPPPPP/1R4KR w HBhb - 0 1";
    let game = createGame(fen);

    const moves = ["e2e4", "e7e5", "g1h1", "g8h8", "b1c1"];
    for (const uci of moves) {
      const move = findUciMove(game, uci);
      expect(move, uci).not.toBeNull();
      game = play(game, move!);
    }

    expect(game.history.map((entry) => toUci(entry.move))).toEqual(moves);
    expect(game.history[2]!.san).toBe("O-O");
    expect(game.history[3]!.san).toBe("O-O");

    // The queen-side rook has since moved off b1, so `b1c1` is an ordinary
    // rook move rather than a castle — the notation is the same either way,
    // which is why the record has to be replayed and not merely read.
    expect(game.history[4]!.move.isCastle).toBeNull();

    // And the same list replays onto the same board from the same start.
    let replayed = createGame(fen);
    for (const uci of moves) {
      replayed = play(replayed, findUciMove(replayed, uci)!);
    }
    expect(toFen(replayed.position)).toBe(toFen(game.position));
  });

  test("undo puts a castle back exactly as it was", () => {
    const game = createGame("1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const before = toFen(game.position);

    const castled = play(game, findUciMove(game, "g1h1")!);
    expect(toFen(castled.position)).not.toBe(before);

    // `undo` restores the saved position rather than unwinding the move, so
    // this is really a check that the saved one was never mutated in place.
    expect(toFen(undo(castled).position)).toBe(before);
  });

  test("toAlgebraic still agrees on the squares a castle names", () => {
    const game = createGame("1r4kr/8/8/8/8/8/8/1R4KR w HBhb - 0 1");
    const move = game.legalMoves.find((m) => m.isCastle === "king")!;

    expect(toAlgebraic(move.from)).toBe("g1");
    expect(toAlgebraic(move.to)).toBe("h1");
  });
});
