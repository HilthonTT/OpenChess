import { describe, expect, test } from "bun:test";

import { findLegalMove } from "./game";
import { fromAlgebraic } from "./board";
import { toUci } from "./pgn";
import {
  expectedMove,
  isPlayablePuzzle,
  movesRemaining,
  puzzleHint,
  puzzleOpeningSquares,
  revealPuzzle,
  solutionSan,
  startPuzzle,
  submitPuzzleMove,
  type Puzzle,
} from "./puzzle";

/**
 * Fool's mate, as a puzzle: after 1. f3 e5 white plays 2. g4?? and black mates
 * with 2... Qh4#. One solver move, and the solver is black.
 */
const FOOLS_MATE: Puzzle = {
  id: "fools",
  fen: "rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq e6 0 2",
  moves: ["g2g4", "d8h4"],
  rating: 600,
  themes: ["mateIn1", "opening"],
};

/**
 * A ladder mate on the back rank: black loosens with ...b6, white doubles up
 * with Ra8, and after the rook trade Rxa8 is mate. Two solver moves, so it
 * exercises the opponent's reply being played by the session itself.
 */
const LADDER: Puzzle = {
  id: "ladder",
  fen: "3r2k1/1p3ppp/8/8/8/8/R7/R5K1 b - - 0 1",
  moves: ["b7b6", "a2a8", "d8a8", "a1a8"],
  rating: 1100,
  themes: ["backRankMate", "mateIn2"],
};

/**
 * A back rank where two different rooks mate. The line records Ra8#; Rb8# is
 * just as final, and a solver who finds it must not be told they were wrong.
 */
const TWO_MATES: Puzzle = {
  id: "two-mates",
  fen: "6k1/3p1ppp/8/8/8/8/1R6/R5K1 b - - 0 1",
  moves: ["d7d6", "a1a8"],
  rating: 700,
  themes: ["backRankMate", "mateIn1"],
};

describe("startPuzzle", () => {
  test("plays the opening move and hands the board to the solver", () => {
    const session = startPuzzle(FOOLS_MATE);

    // White's g4 is the blunder; black is on the move and has the tactic.
    expect(session.you).toBe("b");
    expect(session.game.position.turn).toBe("b");
    expect(session.game.history).toHaveLength(1);
    expect(session.index).toBe(1);
    expect(session.status).toBe("solving");
  });

  test("names the squares of the move that set the puzzle up", () => {
    expect(puzzleOpeningSquares(FOOLS_MATE)).toEqual({ from: "g2", to: "g4" });
  });
});

describe("submitPuzzleMove", () => {
  test("the recorded move solves a one-move puzzle", () => {
    const result = submitPuzzleMove(startPuzzle(FOOLS_MATE), "d8h4");

    expect(result.outcome).toBe("solved");
    expect(result.session.status).toBe("solved");
    expect(result.session.game.status).toBe("checkmate");
  });

  test("a wrong move fails the puzzle and names the answer", () => {
    const result = submitPuzzleMove(startPuzzle(FOOLS_MATE), "e5e4");

    expect(result.outcome).toBe("wrong");
    expect(result.session.status).toBe("failed");
    if (result.outcome === "wrong") {
      expect(result.expected).toBe("d8h4");
    }
  });

  test("an illegal or malformed move fails rather than throwing", () => {
    const session = startPuzzle(FOOLS_MATE);

    expect(submitPuzzleMove(session, "a8a1").outcome).toBe("wrong");
    expect(submitPuzzleMove(session, "nonsense").outcome).toBe("wrong");
  });

  test("plays the opponent's reply itself and keeps the puzzle going", () => {
    const result = submitPuzzleMove(startPuzzle(LADDER), "a2a8");

    expect(result.outcome).toBe("continue");
    expect(result.session.status).toBe("solving");
    // Our move and the reply are both on the board: the solver is up again.
    expect(result.session.game.history).toHaveLength(3);
    expect(result.session.game.position.turn).toBe("w");
    expect(result.session.index).toBe(3);
    if (result.outcome === "continue") {
      expect(toUci(result.reply)).toBe("d8a8");
    }
  });

  test("the last move of a longer line solves it", () => {
    const midway = submitPuzzleMove(startPuzzle(LADDER), "a2a8").session;
    const result = submitPuzzleMove(midway, "a1a8");

    expect(result.outcome).toBe("solved");
    expect(result.session.game.status).toBe("checkmate");
  });

  // The one deliberate departure from the recorded line: Ra8# is on file, but
  // Rb8# mates just as dead, and telling a player who mated that they were
  // wrong is indefensible.
  test("a mate that is not the recorded move is still accepted", () => {
    const result = submitPuzzleMove(startPuzzle(TWO_MATES), "b2b8");

    expect(result.outcome).toBe("solved");
    expect(result.session.game.status).toBe("checkmate");
  });

  test("a non-mating move off the line still fails", () => {
    expect(submitPuzzleMove(startPuzzle(TWO_MATES), "b2b6").outcome).toBe(
      "wrong",
    );
  });

  test("refuses to accept a move once the puzzle is over", () => {
    const solved = submitPuzzleMove(startPuzzle(FOOLS_MATE), "d8h4").session;

    expect(() => submitPuzzleMove(solved, "h4h2")).toThrow(/already over/);
  });
});

describe("movesRemaining", () => {
  test("counts the solver's moves, not the plies", () => {
    const start = startPuzzle(LADDER);
    expect(movesRemaining(start)).toBe(2);

    const midway = submitPuzzleMove(start, "a2a8").session;
    expect(movesRemaining(midway)).toBe(1);

    const solved = submitPuzzleMove(midway, "a1a8").session;
    expect(movesRemaining(solved)).toBe(0);
  });
});

describe("puzzleHint", () => {
  test("names the square the piece stands on, not where it goes", () => {
    expect(puzzleHint(startPuzzle(FOOLS_MATE))).toBe("d8");
    expect(expectedMove(startPuzzle(FOOLS_MATE))).toBe("d8h4");
  });

  test("is null once there is nothing left to find", () => {
    const solved = submitPuzzleMove(startPuzzle(FOOLS_MATE), "d8h4").session;
    expect(puzzleHint(solved)).toBeNull();
  });
});

describe("revealPuzzle", () => {
  test("plays the rest of the line out and settles as a failure", () => {
    const revealed = revealPuzzle(startPuzzle(LADDER));

    expect(revealed.status).toBe("failed");
    // The blunder plus the three moves that were left.
    expect(revealed.game.history).toHaveLength(4);
    expect(revealed.game.status).toBe("checkmate");
  });
});

describe("solutionSan", () => {
  test("reports only the solver's own moves", () => {
    expect(solutionSan(FOOLS_MATE)).toEqual(["Qh4#"]);
    expect(solutionSan(LADDER)).toEqual(["Ra8", "Rxa8#"]);
  });
});

describe("isPlayablePuzzle", () => {
  test("accepts a line that replays", () => {
    expect(isPlayablePuzzle(FOOLS_MATE)).toBe(true);
    expect(isPlayablePuzzle(LADDER)).toBe(true);
  });

  test("rejects a line whose moves are not legal", () => {
    expect(
      isPlayablePuzzle({ fen: FOOLS_MATE.fen, moves: ["g2g4", "a1a8"] }),
    ).toBe(false);
  });

  test("rejects a position with no solver move in it", () => {
    expect(isPlayablePuzzle({ fen: FOOLS_MATE.fen, moves: ["g2g4"] })).toBe(
      false,
    );
  });

  test("rejects an unreadable position", () => {
    expect(isPlayablePuzzle({ fen: "nonsense", moves: ["e2e4", "e7e5"] })).toBe(
      false,
    );
  });
});

describe("a move built from the board", () => {
  test("round-trips through UCI the way a screen submits it", () => {
    const session = startPuzzle(FOOLS_MATE);
    const move = findLegalMove(
      session.game,
      fromAlgebraic("d8")!,
      fromAlgebraic("h4")!,
    );

    expect(move).not.toBeNull();
    expect(submitPuzzleMove(session, toUci(move!)).outcome).toBe("solved");
  });
});
