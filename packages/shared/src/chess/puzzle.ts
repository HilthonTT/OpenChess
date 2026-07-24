import { createGame, play, type Game } from "./game";
import { findUciMove, toUci } from "./pgn";
import type { Color, Move } from "./types";

/**
 * Tactics puzzles.
 *
 * The format is Lichess's, because that is where the corpus comes from and
 * because it is the right shape anyway: a puzzle is a position plus the line
 * that refutes it, and the line is stored *with* the mistake that created the
 * tactic at its head.
 *
 * So `fen` is the position before the blunder, `moves[0]` is the blunder
 * itself, and everything after alternates — the solver plays the odd indices,
 * the opponent's forced replies are the even ones. Starting a puzzle plays the
 * blunder, which is what puts the board in front of the player the way they
 * would have met it over the board: a move has just landed, and there is
 * something to punish.
 *
 * @see https://database.lichess.org/#puzzles
 */

export type Puzzle = {
  id: string;
  /** The position *before* the opening move — see above. */
  fen: string;
  /** UCI, opening move first, then solver/opponent alternating. */
  moves: string[];
  /** Difficulty on the same Elo scale players are rated on. */
  rating: number;
  /** Tactical motifs: "fork", "mateIn2", "sacrifice". Free-form. */
  themes: string[];
};

export type PuzzleStatus = "solving" | "solved" | "failed";

export type PuzzleSession = {
  puzzle: Puzzle;
  /** The board as the solver sees it: the opening move has been played. */
  game: Game;
  /** The side the solver plays. */
  you: Color;
  /**
   * How many moves of `puzzle.moves` have been consumed, the opening move
   * included. Equal to `puzzle.moves.length` on a solved puzzle.
   */
  index: number;
  status: PuzzleStatus;
  /** True once a wrong move has been played — the puzzle no longer pays full. */
  hintUsed: boolean;
};

/**
 * A puzzle whose line does not replay is a broken row, not a hard puzzle. It
 * is thrown rather than skipped so an import that produces one is loud.
 */
function playLine(fen: string, moves: string[]): Game {
  let game = createGame(fen);

  for (const [index, uci] of moves.entries()) {
    const move = findUciMove(game, uci);
    if (!move) {
      throw new Error(
        `Puzzle line is not playable: "${uci}" at index ${index} of ${moves.length}`,
      );
    }
    game = play(game, move);
  }

  return game;
}

/** Whether a puzzle's stored line replays from its stored position. */
export function isPlayablePuzzle(puzzle: {
  fen: string;
  moves: string[];
}): boolean {
  // A puzzle with no solver move is a position, not a puzzle: the opening move
  // would leave nothing to find.
  if (puzzle.moves.length < 2) {
    return false;
  }

  try {
    playLine(puzzle.fen, puzzle.moves);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a puzzle: play the opening move and hand back the board to solve, with
 * the solver on the move.
 */
export function startPuzzle(puzzle: Puzzle): PuzzleSession {
  const opening = puzzle.moves[0];
  if (opening === undefined) {
    throw new Error(`Puzzle ${puzzle.id} has no moves`);
  }

  const game = playLine(puzzle.fen, [opening]);

  return {
    puzzle,
    game,
    you: game.position.turn,
    index: 1,
    status: "solving",
    hintUsed: false,
  };
}

export type PuzzleMoveResult =
  | {
      outcome: "wrong";
      session: PuzzleSession;
      /** The move that should have been played, in UCI. */
      expected: string;
    }
  | {
      outcome: "continue";
      session: PuzzleSession;
      /** The reply the opponent was forced into, already on the board. */
      reply: Move;
    }
  | { outcome: "solved"; session: PuzzleSession };

/** The solver's move the line expects next, or null once the puzzle is over. */
export function expectedMove(session: PuzzleSession): string | null {
  return session.puzzle.moves[session.index] ?? null;
}

/**
 * The square the piece to move stands on. The cheapest hint that is still a
 * hint: it names the piece without giving away where it goes.
 */
export function puzzleHint(session: PuzzleSession): string | null {
  const expected = expectedMove(session);
  return expected ? expected.slice(0, 2) : null;
}

/**
 * Play the solver's move.
 *
 * The recorded line is the answer, with one deliberate exception: a move that
 * delivers checkmate is always accepted. Puzzle lines record one mate when
 * several exist, and telling a player who just mated that they were wrong is
 * indefensible — so mate ends the puzzle as a solve whether or not it was the
 * mate on file.
 *
 * Anything else that leaves the line fails the puzzle. The session comes back
 * unadvanced in that case, so a caller can keep showing the position.
 */
export function submitPuzzleMove(
  session: PuzzleSession,
  uci: string,
): PuzzleMoveResult {
  if (session.status !== "solving") {
    throw new Error("This puzzle is already over");
  }

  const expected = expectedMove(session);
  if (expected === null) {
    throw new Error("This puzzle has no move left to play");
  }

  const move = findUciMove(session.game, uci);

  if (!move) {
    return { outcome: "wrong", session: { ...session, status: "failed" }, expected };
  }

  const played = play(session.game, move);
  const matchesLine = toUci(move) === expected;

  if (!matchesLine && played.status !== "checkmate") {
    return {
      outcome: "wrong",
      session: { ...session, status: "failed" },
      expected,
    };
  }

  // Mate ends it however it was reached — including a mate found early, which
  // makes the rest of the recorded line moot.
  if (played.status === "checkmate") {
    return {
      outcome: "solved",
      session: {
        ...session,
        game: played,
        index: session.index + 1,
        status: "solved",
      },
    };
  }

  const replyUci = session.puzzle.moves[session.index + 1];

  // No reply on file means that was the last move of the line.
  if (replyUci === undefined) {
    return {
      outcome: "solved",
      session: {
        ...session,
        game: played,
        index: session.index + 1,
        status: "solved",
      },
    };
  }

  const reply = findUciMove(played, replyUci);
  if (!reply) {
    throw new Error(
      `Puzzle ${session.puzzle.id} has an unplayable reply "${replyUci}"`,
    );
  }

  return {
    outcome: "continue",
    session: {
      ...session,
      game: play(played, reply),
      index: session.index + 2,
      status: "solving",
    },
    reply,
  };
}

/** Mark the hint as spent, so the payout knows the solve was assisted. */
export function useHint(session: PuzzleSession): PuzzleSession {
  return { ...session, hintUsed: true };
}

/**
 * Give up: play the rest of the line out so the player can see the answer, and
 * settle the puzzle as failed.
 */
export function revealPuzzle(session: PuzzleSession): PuzzleSession {
  const remaining = session.puzzle.moves.slice(session.index);

  let game = session.game;
  for (const uci of remaining) {
    const move = findUciMove(game, uci);
    if (!move) {
      break;
    }
    game = play(game, move);
  }

  return {
    ...session,
    game,
    index: session.puzzle.moves.length,
    status: "failed",
  };
}

/**
 * The solution as SAN, for showing the line once the puzzle is over. Only the
 * solver's own moves — the opponent's replies are forced and reading them back
 * is noise.
 */
export function solutionSan(puzzle: Puzzle): string[] {
  let game = createGame(puzzle.fen);
  const sans: string[] = [];

  for (const [index, uci] of puzzle.moves.entries()) {
    const move = findUciMove(game, uci);
    if (!move) {
      break;
    }
    game = play(game, move);

    // Index 0 is the blunder that set the puzzle up; the solver has the odd ones.
    if (index % 2 === 1) {
      sans.push(game.history[game.history.length - 1]!.san);
    }
  }

  return sans;
}

/** The squares of the opening move, so a screen can show what was just played. */
export function puzzleOpeningSquares(
  puzzle: Puzzle,
): { from: string; to: string } | null {
  const opening = puzzle.moves[0];
  if (opening === undefined || opening.length < 4) {
    return null;
  }
  return { from: opening.slice(0, 2), to: opening.slice(2, 4) };
}

/**
 * How much of the puzzle is left, in solver moves. Drives the "one move to go"
 * line a multi-move puzzle needs to stop reading as a failure when the first
 * correct move does not end it.
 */
export function movesRemaining(session: PuzzleSession): number {
  return Math.max(
    0,
    Math.ceil((session.puzzle.moves.length - session.index) / 2),
  );
}

