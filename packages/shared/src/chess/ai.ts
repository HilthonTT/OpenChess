import { isPiece, pieceColor } from "./board";
import {
  applyMove,
  generateLegalMoves,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { pieceValue } from "./game";
import type { Move, PieceType, Position } from "./types";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/** Search depth in plies. Easy is a pure one-ply material grab. */
const SEARCH_DEPTH: Record<Difficulty, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
};

/** Large enough to outrank any material swing, small enough to add plies to. */
const MATE_SCORE = 100_000;

/**
 * Piece-square tables in centipawns, from white's point of view. The arrays
 * are laid out in board order (index 0 = a8), so a white piece reads its
 * square directly and a black piece reads the vertical mirror (`square ^ 56`).
 */
const PIECE_SQUARE_TABLES: Record<PieceType, number[]> = {
  // prettier-ignore
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  // prettier-ignore
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  // prettier-ignore
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  // prettier-ignore
  r: [
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
  ],
  // prettier-ignore
  q: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  // prettier-ignore
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
};

/**
 * Static evaluation in centipawns from the side-to-move's point of view, as
 * negamax expects: material (via `pieceValue`) plus piece-square bonuses.
 */
function evaluate(position: Position): number {
  let score = 0;

  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (piece === undefined || !isPiece(piece)) {
      continue;
    }

    const type = piece.toLowerCase() as PieceType;
    const table = PIECE_SQUARE_TABLES[type];
    if (pieceColor(piece) === "w") {
      score += pieceValue(piece) * 100 + (table[square] ?? 0);
    } else {
      score -= pieceValue(piece) * 100 + (table[square ^ 56] ?? 0);
    }
  }

  return position.turn === "w" ? score : -score;
}

/**
 * Captures and promotions first (most valuable victim, least valuable
 * attacker) so alpha-beta prunes early.
 */
function orderMoves(moves: Move[]): Move[] {
  const priority = (move: Move): number => {
    let value = 0;
    if (move.captured !== null) {
      value += 10 * pieceValue(move.captured) - pieceValue(move.piece);
    }
    if (move.promotion !== null) {
      value += 10 * pieceValue(move.promotion === "q" ? "q" : move.promotion);
    }
    return value;
  };

  return [...moves].sort((a, b) => priority(b) - priority(a));
}

function negamax(
  position: Position,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  const moves = generateLegalMoves(position);

  if (moves.length === 0) {
    // Prefer faster mates (and slower losses) by counting plies from the root.
    return isInCheck(position, position.turn) ? -(MATE_SCORE - ply) : 0;
  }

  if (position.halfmoveClock >= 100 || isInsufficientMaterial(position)) {
    return 0;
  }

  if (depth === 0) {
    return evaluate(position);
  }

  let best = -Infinity;
  for (const move of orderMoves(moves)) {
    const score = -negamax(
      applyMove(position, move),
      depth - 1,
      -beta,
      -alpha,
      ply + 1,
    );

    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) {
      break;
    }
  }

  return best;
}

/**
 * Pick a move for the side to move. Easy plays randomly, medium and hard run
 * an alpha-beta search and choose at random among the equal-best moves so
 * games don't repeat themselves. Returns null when there is no legal move.
 */
export function findBestMove(
  position: Position,
  difficulty: Difficulty,
): Move | null {
  const moves = generateLegalMoves(position);
  if (moves.length === 0) {
    return null;
  }

  if (difficulty === "easy") {
    return moves[Math.floor(Math.random() * moves.length)] ?? null;
  }

  const depth = SEARCH_DEPTH[difficulty];
  let bestScore = -Infinity;
  let bestMoves: Move[] = [];

  for (const move of orderMoves(moves)) {
    // Window open by one centipawn below the best so far, so moves that tie
    // the best are searched exactly and the tie-break stays fair.
    const score = -negamax(
      applyMove(position, move),
      depth - 1,
      -Infinity,
      -(bestScore - 1),
      1,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) {
      bestMoves.push(move);
    }
  }

  return bestMoves[Math.floor(Math.random() * bestMoves.length)] ?? null;
}
