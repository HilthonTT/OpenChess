import { describe, expect, test } from "bun:test";
import { opposite, parseFen } from "./board";
import { evaluate, hasNonPawnMaterial } from "./evaluate";
import { evaluatePosition } from "./ai";
import type { Board, Piece, Position } from "./types";
import { EMPTY } from "./types";

function mirror(position: Position): Position {
  const board: Board = new Array<string>(64).fill(EMPTY) as Board;

  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (piece === undefined || piece === EMPTY) {
      continue;
    }

    const swapped =
      piece === piece.toUpperCase() ? piece.toLowerCase() : piece.toUpperCase();
    board[square ^ 56] = swapped as Piece;
  }

  return {
    board,
    turn: opposite(position.turn),
    castling: {
      whiteKingSide: position.castling.blackKingSide,
      whiteQueenSide: position.castling.blackQueenSide,
      blackKingSide: position.castling.whiteKingSide,
      blackQueenSide: position.castling.whiteQueenSide,
    },
    castlingFiles: {
      w: position.castlingFiles.b,
      b: position.castlingFiles.w,
    },
    enPassant: position.enPassant === null ? null : position.enPassant ^ 56,
    halfmoveClock: position.halfmoveClock,
    fullmoveNumber: position.fullmoveNumber,
  };
}

describe("evaluate", () => {
  test("the start position is level", () => {
    expect(
      evaluatePosition(
        parseFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"),
      ),
    ).toBe(0);
  });

  test("scores from the side to move's point of view", () => {
    const whiteToMove = parseFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    const blackToMove = parseFen("4k3/8/8/8/8/8/8/3QK3 b - - 0 1");

    expect(evaluate(whiteToMove)).toBeGreaterThan(0);
    expect(evaluate(blackToMove)).toBeLessThan(0);
  });

  test("a mirrored position scores exactly the opposite", () => {
    const positions = [
      "r1bq1r1k/pp2n1pp/2n1p3/2ppP3/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 12",
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
      "4k3/8/8/3P4/8/8/8/4K3 w - - 0 1",
      "8/8/8/4k3/8/8/8/KBB5 w - - 0 1",
      "4k3/8/8/8/2pP4/8/8/4K3 b - d3 0 1",
    ];

    for (const fen of positions) {
      const position = parseFen(fen);
      expect(evaluatePosition(mirror(position)), fen).toBe(
        -evaluatePosition(position),
      );
    }
  });
});

describe("tapering between middlegame and endgame", () => {
  test("with the pieces on, a king is better off tucked behind its pawns", () => {
    const castled = parseFen(
      "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQ1RK1 w kq - 0 1",
    );
    const wandering = parseFen(
      "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N1KN2/PPPP1PPP/R1BQ1R2 w kq - 0 1",
    );

    expect(evaluatePosition(castled)).toBeGreaterThan(
      evaluatePosition(wandering),
    );
  });

  test("with the pieces off, a king is better off in the middle", () => {
    const central = parseFen("4k2r/8/8/4K3/8/8/8/R7 w - - 0 1");
    const cornered = parseFen("4k2r/8/8/8/8/8/8/RK6 w - - 0 1");

    expect(evaluatePosition(central)).toBeGreaterThan(
      evaluatePosition(cornered),
    );
  });
});

describe("pawn structure", () => {
  test("a passed pawn beats one a neighbouring pawn can stop", () => {
    const passed = parseFen("4k3/8/p7/3P4/8/8/8/4K3 w - - 0 1");
    const stopped = parseFen("4k3/8/4p3/3P4/8/8/8/4K3 w - - 0 1");

    expect(evaluatePosition(passed)).toBeGreaterThan(evaluatePosition(stopped));
  });

  test("doubling a pawn costs, with everything else held equal", () => {
    const doubled = parseFen("4k3/8/8/3P4/2PP4/8/8/4K3 w - - 0 1");
    const spread = parseFen("4k3/8/8/4P3/2PP4/8/8/4K3 w - - 0 1");

    expect(evaluatePosition(doubled)).toBeLessThan(evaluatePosition(spread));
  });

  test("an isolated pawn costs", () => {
    const isolated = parseFen("4k3/8/8/8/P1P5/8/8/4K3 w - - 0 1");
    const connected = parseFen("4k3/8/8/8/PP6/8/8/4K3 w - - 0 1");

    expect(evaluatePosition(isolated)).toBeLessThan(
      evaluatePosition(connected),
    );
  });
});

describe("the mating drive", () => {
  test("with pieces alone, a defending king on the edge is worse off", () => {
    const cornered = parseFen("7k/8/8/8/8/8/8/KBB5 w - - 0 1");
    const central = parseFen("8/8/8/4k3/8/8/8/KBB5 w - - 0 1");

    expect(evaluatePosition(cornered)).toBeGreaterThan(
      evaluatePosition(central),
    );
  });

  test("it does not fire while there are pawns to play for", () => {
    const edge = parseFen("7k/8/8/8/8/8/1P6/KBB5 w - - 0 1");
    const centre = parseFen("8/8/8/4k3/8/8/1P6/KBB5 w - - 0 1");

    const difference = Math.abs(
      evaluatePosition(edge) - evaluatePosition(centre),
    );

    expect(difference).toBeLessThan(100);
  });
});

describe("hasNonPawnMaterial", () => {
  test("sees a piece", () => {
    const position = parseFen("4k3/8/8/8/8/8/8/4KB2 w - - 0 1");
    expect(hasNonPawnMaterial(position, "w")).toBe(true);
    expect(hasNonPawnMaterial(position, "b")).toBe(false);
  });

  test("pawns and kings do not count", () => {
    const position = parseFen("4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1");
    expect(hasNonPawnMaterial(position, "w")).toBe(false);
    expect(hasNonPawnMaterial(position, "b")).toBe(false);
  });
});
