import { describe, expect, test } from "bun:test";
import { fromAlgebraic, parseFen, toAlgebraic } from "./board";
import { createGame, play } from "./game";
import { applyMove, findMove, generateLegalMoves, isInCheck } from "./moves";
import { search, see } from "./search";
import { hashPosition } from "./zobrist";
import type { Game } from "./game";
import type { Move, Position } from "./types";

function moveFor(position: Position, from: string, to: string): Move {
  const move = findMove(
    generateLegalMoves(position),
    fromAlgebraic(from)!,
    fromAlgebraic(to)!,
  );

  if (!move) {
    throw new Error(`${from}${to} is not legal here`);
  }

  return move;
}

function isMate(position: Position): boolean {
  return (
    generateLegalMoves(position).length === 0 &&
    isInCheck(position, position.turn)
  );
}

function forcesMateInTwo(position: Position, move: Move): boolean {
  const after = applyMove(position, move);
  const replies = generateLegalMoves(after);

  if (replies.length === 0) {
    return false;
  }

  return replies.every((reply) => {
    const next = applyMove(after, reply);
    return generateLegalMoves(next).some((finisher) =>
      isMate(applyMove(next, finisher)),
    );
  });
}

describe("see", () => {
  test("a free piece is worth the piece", () => {
    const position = parseFen("k7/8/8/3n4/8/8/3R4/K7 w - - 0 1");
    expect(see(position, moveFor(position, "d2", "d5"))).toBe(320);
  });

  test("a defended piece counts the recapture", () => {
    const position = parseFen("k7/8/2p5/3n4/8/8/3R4/K7 w - - 0 1");
    expect(see(position, moveFor(position, "d2", "d5"))).toBe(320 - 500);
  });

  test("a whole exchange resolves, cheapest piece first", () => {
    const position = parseFen("k7/8/2p5/3r4/8/8/3R4/K2R4 w - - 0 1");
    expect(see(position, moveFor(position, "d2", "d5"))).toBe(500 - 500 + 100);
  });

  test("taking a defended pawn with a queen loses the exchange", () => {
    const position = parseFen("k7/8/2p5/3p4/8/8/3Q4/K7 w - - 0 1");
    expect(see(position, moveFor(position, "d2", "d5"))).toBeLessThan(0);
  });

  test("a capture that wins the defender first is not punished", () => {
    const defended = parseFen("k7/8/2p5/3n4/8/8/3R4/K7 w - - 0 1");
    const undefended = parseFen("k7/8/8/3n4/8/8/3R4/K7 w - - 0 1");

    expect(see(defended, moveFor(defended, "d2", "d5"))).toBeLessThan(0);
    expect(see(undefended, moveFor(undefended, "d2", "d5"))).toBeGreaterThan(0);
  });
});

describe("zobrist keys", () => {
  test("the same position keys the same", () => {
    const fen =
      "r1bq1r1k/pp2n1pp/2n1p3/2ppP3/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 12";
    expect(hashPosition(parseFen(fen))).toBe(hashPosition(parseFen(fen)));
  });

  test("the side to move is part of the position", () => {
    const white = parseFen("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    const black = parseFen("4k3/8/8/8/8/8/8/4K3 b - - 0 1");
    expect(hashPosition(white)).not.toBe(hashPosition(black));
  });

  test("castling rights are part of the position", () => {
    const withRights = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const without = parseFen("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
    expect(hashPosition(withRights)).not.toBe(hashPosition(without));
  });

  test("a different move order into the same position keys the same", () => {
    let game = createGame();
    const start = hashPosition(game.position);

    for (const [from, to] of [
      ["g1", "f3"],
      ["g8", "f6"],
      ["f3", "g1"],
      ["f6", "g8"],
    ]) {
      game = play(game, moveFor(game.position, from!, to!));
    }

    expect(hashPosition(game.position)).toBe(start);
  });

  test("an en passant square nobody can capture on is not a difference", () => {
    const phantom = parseFen("4k3/8/8/8/3P4/8/8/4K3 b - d3 0 1");
    const none = parseFen("4k3/8/8/8/3P4/8/8/4K3 b - - 0 1");
    expect(hashPosition(phantom)).toBe(hashPosition(none));
  });

  test("an en passant square a pawn can capture on is a difference", () => {
    const real = parseFen("4k3/8/8/8/2pP4/8/8/4K3 b - d3 0 1");
    const none = parseFen("4k3/8/8/8/2pP4/8/8/4K3 b - - 0 1");
    expect(hashPosition(real)).not.toBe(hashPosition(none));
  });
});

describe("search", () => {
  test("no legal move means no move", () => {
    const mated = parseFen("k7/1Q6/1K6/8/8/8/8/8 b - - 0 1");
    expect(search(mated, { depth: 4 }).bestMove).toBeNull();
  });

  test("finds a forced mate in two and says how far off it is", () => {
    const position = parseFen("r5rk/5p1p/5R2/4Q3/8/8/7P/7K w - - 0 1");
    const result = search(position, { depth: 6, nodes: 500_000 });

    expect(result.bestMove).not.toBeNull();
    expect(forcesMateInTwo(position, result.bestMove!)).toBe(true);
    expect(result.score).toBe(100_000 - 3);
  });

  test("finds a forced mate in two with only a queen", () => {
    const position = parseFen("k7/8/1K6/8/8/8/8/1Q6 w - - 0 1");
    const result = search(position, { depth: 6, nodes: 500_000 });

    expect(result.bestMove).not.toBeNull();
    expect(forcesMateInTwo(position, result.bestMove!)).toBe(true);
  });

  test("takes mate over material", () => {
    const position = parseFen("7k/6pp/8/8/8/8/8/R2n2K1 w - - 0 1");
    const result = search(position, { depth: 5 });

    expect(toAlgebraic(result.bestMove!.to)).toBe("a8");
    expect(isMate(applyMove(position, result.bestMove!))).toBe(true);
  });

  test("prefers the mate it can reach soonest", () => {
    const position = parseFen("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1");
    expect(search(position, { depth: 5 }).score).toBe(100_000 - 1);
  });

  test("a node budget is the same on every machine, so the answer is too", () => {
    const position = parseFen(
      "r1bq1r1k/pp2n1pp/2n1p3/2ppP3/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 12",
    );

    const first = search(position, { nodes: 20_000 });
    const second = search(position, { nodes: 20_000 });

    expect(first.score).toBe(second.score);
    expect(first.depth).toBe(second.depth);
    expect(first.nodes).toBe(second.nodes);
    expect(first.bestMove!.from).toBe(second.bestMove!.from);
    expect(first.bestMove!.to).toBe(second.bestMove!.to);
  });

  test("stops at the node budget", () => {
    const position = parseFen(
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    );
    const result = search(position, { nodes: 10_000 });

    expect(result.nodes).toBeGreaterThan(1000);
    expect(result.nodes).toBeLessThanOrEqual(10_064);
  });

  test("stops at the time budget", () => {
    const position = parseFen(
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    );

    const started = Date.now();
    const result = search(position, { timeMs: 150 });
    const elapsed = Date.now() - started;

    expect(result.bestMove).not.toBeNull();
    expect(elapsed).toBeLessThan(1500);
  });

  test("a deeper budget reaches a deeper answer", () => {
    const position = parseFen(
      "r1bq1r1k/pp2n1pp/2n1p3/2ppP3/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 12",
    );

    const shallow = search(position, { nodes: 3_000 });
    const deep = search(position, { nodes: 80_000 });

    expect(deep.depth).toBeGreaterThan(shallow.depth);
    expect(deep.depth).toBeGreaterThan(3);
  });

  test("the expected line is playable from the position it starts in", () => {
    const position = parseFen(
      "r1bq1r1k/pp2n1pp/2n1p3/2ppP3/3P4/2PB1N2/PP3PPP/R1BQ1RK1 w - - 0 12",
    );
    const result = search(position, { nodes: 50_000 });

    expect(result.pv.length).toBeGreaterThan(1);
    expect(result.pv[0]).toEqual(result.bestMove!);

    let current = position;
    for (const move of result.pv) {
      const legal = findMove(
        generateLegalMoves(current),
        move.from,
        move.to,
        move.promotion ?? undefined,
      );
      expect(
        legal,
        `${toAlgebraic(move.from)}${toAlgebraic(move.to)}`,
      ).toBeDefined();
      current = applyMove(current, move);
    }
  });

  test("declines a capture that loses the exchange", () => {
    const position = parseFen("k7/8/2p5/3n4/8/8/3R4/K7 w - - 0 1");
    const result = search(position, { depth: 5 });
    expect(toAlgebraic(result.bestMove!.to)).not.toBe("d5");
  });

  test("randomising the root still returns a legal move", () => {
    const position = parseFen(
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = search(position, { depth: 3, randomize: true });
      expect(
        findMove(
          generateLegalMoves(position),
          result.bestMove!.from,
          result.bestMove!.to,
        ),
      ).toBeDefined();
    }
  });
});

describe("converting a won endgame", () => {
  function playOut(fen: string, cap: number): Game {
    let game = createGame(fen);

    for (let ply = 0; ply < cap; ply += 1) {
      if (game.status !== "playing" && game.status !== "check") {
        break;
      }

      const result = search(
        game.position,
        { depth: 6, nodes: 120_000 },
        game.history.map((entry) => entry.before),
      );

      if (!result.bestMove) {
        break;
      }

      game = play(game, result.bestMove);
    }

    return game;
  }

  const CONVERSION_TIMEOUT_MS = 60_000;

  test(
    "king and queen mate",
    () => {
      expect(playOut("8/8/8/4k3/8/8/8/K6Q w - - 0 1", 80).status).toBe(
        "checkmate",
      );
    },
    CONVERSION_TIMEOUT_MS,
  );

  test(
    "king and rook mate",
    () => {
      expect(playOut("8/8/8/4k3/8/8/8/K6R w - - 0 1", 90).status).toBe(
        "checkmate",
      );
    },
    CONVERSION_TIMEOUT_MS,
  );

  test(
    "two bishops mate",
    () => {
      expect(playOut("8/8/8/4k3/8/8/8/KBB5 w - - 0 1", 95).status).toBe(
        "checkmate",
      );
    },
    CONVERSION_TIMEOUT_MS,
  );

  test("a bare king against a bare king is a draw, not a shuffle to nowhere", () => {
    const game = playOut("8/8/8/4k3/8/8/8/K7 w - - 0 1", 10);
    expect(game.status).toBe("draw-insufficient-material");
  });
});
