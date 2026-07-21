import { isPiece, pieceColor } from "./board";
import {
  applyMove,
  generateLegalMoves,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { pieceValue } from "./game";
import type { Color, Move, PieceType, Position } from "./types";

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

/**
 * The same engine turned inward, for reviewing a game rather than playing one.
 *
 * `analyzePosition` reports what the search thinks of a position; `centipawnLoss`
 * turns a pair of those verdicts into how much a move gave away, and
 * `classifyMove` labels that loss the way an analysis board does. All scores are
 * centipawns from *white's* point of view — positive favours white — so the
 * whole game reads on one axis rather than flipping with the side to move.
 */

/** Default review depth. A ply deeper than `hard` play, still snappy on the client. */
export const ANALYSIS_DEPTH = 3;

export type MoveQuality =
  | "best"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export type Analysis = {
  /** Centipawns from white's POV; positive favours white. */
  scoreCp: number;
  /**
   * Moves until forced mate — positive when white is mating, negative when
   * black is — or null when neither side has one in view.
   */
  mateIn: number | null;
  /** The move the search would play, or null in a terminal position. */
  bestMove: Move | null;
};

/**
 * Static evaluation in centipawns from white's point of view. `evaluate` scores
 * from the side to move's perspective, the way negamax needs; this flips it so
 * callers get one consistent axis.
 */
export function evaluatePosition(position: Position): number {
  const score = evaluate(position);
  return position.turn === "w" ? score : -score;
}

/** How close to `MATE_SCORE` a value must be to be read as a forced mate. */
const MATE_THRESHOLD = MATE_SCORE - 1000;

/** Search `position` and report the verdict, white's POV. */
export function analyzePosition(
  position: Position,
  depth: number = ANALYSIS_DEPTH,
): Analysis {
  const moves = generateLegalMoves(position);

  // A terminal position has no move to recommend: checkmate is a decisive
  // score for whoever delivered it, any other end is a dead-level draw.
  if (moves.length === 0) {
    if (isInCheck(position, position.turn)) {
      const whiteMated = position.turn === "w";
      return {
        scoreCp: whiteMated ? -MATE_SCORE : MATE_SCORE,
        // The mate is already on the board — zero moves away, either side.
        mateIn: 0,
        bestMove: null,
      };
    }
    return { scoreCp: 0, mateIn: null, bestMove: null };
  }

  if (
    position.halfmoveClock >= 100 ||
    isInsufficientMaterial(position)
  ) {
    return { scoreCp: 0, mateIn: null, bestMove: null };
  }

  // A full-window root search — no aspiration trick, because here the true best
  // score matters, not just which move ties for it.
  let bestScore = -Infinity;
  let bestMove: Move | null = null;

  for (const move of orderMoves(moves)) {
    const score = -negamax(
      applyMove(position, move),
      depth - 1,
      -Infinity,
      Infinity,
      1,
    );

    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }

  // `bestScore` is from the side to move's POV; flip it to white's.
  const whiteScore = position.turn === "w" ? bestScore : -bestScore;

  let mateIn: number | null = null;
  if (Math.abs(bestScore) >= MATE_THRESHOLD) {
    const plies = MATE_SCORE - Math.abs(bestScore);
    const movesToMate = Math.max(1, Math.ceil(plies / 2));
    // The side to move is mating when its score is positive.
    const whiteMating = (bestScore > 0) === (position.turn === "w");
    mateIn = whiteMating ? movesToMate : -movesToMate;
  }

  return { scoreCp: whiteScore, mateIn, bestMove };
}

/**
 * How much the mover gave up, in centipawns, given the white-POV evaluation
 * before and after their move. A move that keeps the evaluation where it stood
 * loses nothing; one that hands the opponent an edge loses the difference.
 * Never negative — a move that happens to out-search the reference position (a
 * shallow search finding more on the reply) is not a "gain", it is noise.
 */
export function centipawnLoss(
  mover: Color,
  whiteEvalBefore: number,
  whiteEvalAfter: number,
): number {
  const delta =
    mover === "w"
      ? whiteEvalBefore - whiteEvalAfter
      : whiteEvalAfter - whiteEvalBefore;
  return Math.max(0, delta);
}

/**
 * Thresholds in centipawns. Generous at the top — a one-ply-shallow review
 * should not brand every third move an inaccuracy — and unmistakable at the
 * bottom, where a blunder is a piece or a lost game.
 */
export function classifyMove(centipawnLoss: number): MoveQuality {
  if (centipawnLoss <= 20) {
    return "best";
  }
  if (centipawnLoss <= 60) {
    return "good";
  }
  if (centipawnLoss <= 120) {
    return "inaccuracy";
  }
  if (centipawnLoss <= 250) {
    return "mistake";
  }
  return "blunder";
}
