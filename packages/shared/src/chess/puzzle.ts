import { createGame, play, type Game } from "./game";
import { findUciMove, toUci } from "./pgn";
import type { Color, Move } from "./types";

export type Puzzle = {
  id: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
};

export type PuzzleStatus = "solving" | "solved" | "failed";

export type PuzzleSession = {
  puzzle: Puzzle;
  game: Game;
  you: Color;
  index: number;
  status: PuzzleStatus;
  hintUsed: boolean;
};

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

export function isPlayablePuzzle(puzzle: {
  fen: string;
  moves: string[];
}): boolean {
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
      expected: string;
    }
  | {
      outcome: "continue";
      session: PuzzleSession;
      reply: Move;
    }
  | { outcome: "solved"; session: PuzzleSession };

export function expectedMove(session: PuzzleSession): string | null {
  return session.puzzle.moves[session.index] ?? null;
}

export function puzzleHint(session: PuzzleSession): string | null {
  const expected = expectedMove(session);
  return expected ? expected.slice(0, 2) : null;
}

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
    return {
      outcome: "wrong",
      session: { ...session, status: "failed" },
      expected,
    };
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

export function useHint(session: PuzzleSession): PuzzleSession {
  return { ...session, hintUsed: true };
}

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

export function solutionSan(puzzle: Puzzle): string[] {
  let game = createGame(puzzle.fen);
  const sans: string[] = [];

  for (const [index, uci] of puzzle.moves.entries()) {
    const move = findUciMove(game, uci);
    if (!move) {
      break;
    }
    game = play(game, move);

    if (index % 2 === 1) {
      sans.push(game.history[game.history.length - 1]!.san);
    }
  }

  return sans;
}

export function puzzleOpeningSquares(
  puzzle: Puzzle,
): { from: string; to: string } | null {
  const opening = puzzle.moves[0];
  if (opening === undefined || opening.length < 4) {
    return null;
  }
  return { from: opening.slice(0, 2), to: opening.slice(2, 4) };
}

export function movesRemaining(session: PuzzleSession): number {
  return Math.max(
    0,
    Math.ceil((session.puzzle.moves.length - session.index) / 2),
  );
}
