import { evaluate, hasNonPawnMaterial } from "../evaluate";
import {
  applyMove,
  findMove,
  generateLegalCaptures,
  generateLegalMoves,
  hasLegalMove,
  isInCheck,
  isInsufficientMaterial,
} from "../moves";
import { hashPosition } from "../zobrist";
import type { Move, Position, PromotionPiece } from "../types";

import {
  DELTA_MARGIN,
  MATE_SCORE,
  MATE_THRESHOLD,
  MAX_EXTENSIONS,
  MAX_PLY,
  MAX_QUIESCENCE_PLY,
} from "./constants";
import { exchangeValueOf, see } from "./exchange";
import {
  orderCaptures,
  rememberHistory,
  rememberKiller,
  scoreMove,
  selectMove,
} from "./ordering";
import {
  type SearchState,
  drawScore,
  isRepetition,
  outOfBudget,
  passTurn,
} from "./state";
import {
  EXACT,
  LOWER_BOUND,
  UPPER_BOUND,
  probe,
  probed,
  store,
} from "./transposition";

function quiescence(
  state: SearchState,
  position: Position,
  alpha: number,
  beta: number,
  ply: number,
  depth: number,
): number {
  state.nodes += 1;

  if (outOfBudget(state)) {
    state.aborted = true;
  }
  if (state.aborted) {
    return 0;
  }

  if (ply >= MAX_PLY) {
    return evaluate(position, state.weights);
  }

  const inCheck = isInCheck(position, position.turn);

  const moves = inCheck
    ? generateLegalMoves(position)
    : generateLegalCaptures(position);

  if (moves.length === 0) {
    if (inCheck) {
      return -(MATE_SCORE - ply);
    }

    if (!hasLegalMove(position)) {
      return drawScore(state, position);
    }
  }

  if (position.halfmoveClock >= 100 || isInsufficientMaterial(position)) {
    return drawScore(state, position);
  }

  let best: number;

  if (inCheck) {
    if (depth === 0) {
      return evaluate(position, state.weights);
    }
    best = -Infinity;
  } else {
    best = evaluate(position, state.weights);

    if (best >= beta || depth === 0) {
      return best;
    }
    if (best > alpha) {
      alpha = best;
    }
  }

  for (const move of orderCaptures(moves)) {
    if (!inCheck) {
      if (
        move.promotion === null &&
        move.captured !== null &&
        best + exchangeValueOf(move.captured) + DELTA_MARGIN <= alpha
      ) {
        continue;
      }

      if (see(position, move) < 0) {
        continue;
      }
    }

    const score = -quiescence(
      state,
      applyMove(position, move),
      -beta,
      -alpha,
      ply + 1,
      depth - 1,
    );

    if (state.aborted) {
      return 0;
    }

    if (score > best) {
      best = score;
    }
    if (score > alpha) {
      alpha = score;
    }
    if (alpha >= beta) {
      break;
    }
  }

  return best;
}

export function negamax(
  state: SearchState,
  position: Position,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  canPass: boolean,
  extensions: number,
): number {
  state.nodes += 1;

  if (outOfBudget(state)) {
    state.aborted = true;
  }
  if (state.aborted) {
    return 0;
  }

  if (ply >= MAX_PLY) {
    return evaluate(position, state.weights);
  }

  const key = hashPosition(position);
  state.path[ply] = key;

  if (isRepetition(state, key, ply) || isInsufficientMaterial(position)) {
    return drawScore(state, position);
  }

  const soonestMate = MATE_SCORE - ply - 1;
  const latestLoss = -(MATE_SCORE - ply);
  if (alpha < latestLoss) {
    alpha = latestLoss;
  }
  if (beta > soonestMate) {
    beta = soonestMate;
  }
  if (alpha >= beta) {
    return alpha;
  }

  const found = probe(key, ply);
  const tableFromSquare = found ? probed.from : -1;
  const tableToSquare = found ? probed.to : -1;
  const tablePromotion = found ? probed.promotion : null;

  if (found && probed.depth >= depth) {
    const score = probed.score;
    if (
      probed.flag === EXACT ||
      (probed.flag === LOWER_BOUND && score >= beta) ||
      (probed.flag === UPPER_BOUND && score <= alpha)
    ) {
      return score;
    }
  }

  const inCheck = isInCheck(position, position.turn);

  if (inCheck && depth >= 1 && extensions < MAX_EXTENSIONS) {
    depth += 1;
    extensions += 1;
  }

  if (depth <= 0) {
    return quiescence(state, position, alpha, beta, ply, MAX_QUIESCENCE_PLY);
  }

  if (
    canPass &&
    !inCheck &&
    depth >= 3 &&
    beta < MATE_THRESHOLD &&
    hasNonPawnMaterial(position, position.turn)
  ) {
    const reduction = depth >= 6 ? 3 : 2;
    const score = -negamax(
      state,
      passTurn(position),
      depth - 1 - reduction,
      -beta,
      -beta + 1,
      ply + 1,
      false,
      extensions,
    );

    if (state.aborted) {
      return 0;
    }

    if (score >= beta) {
      return score >= MATE_THRESHOLD ? beta : score;
    }
  }

  const moves = generateLegalMoves(position);

  if (moves.length === 0) {
    return inCheck ? -(MATE_SCORE - ply) : drawScore(state, position);
  }

  if (position.halfmoveClock >= 100) {
    return drawScore(state, position);
  }

  const scores = moves.map((move) =>
    scoreMove(
      state,
      position,
      move,
      ply,
      tableFromSquare,
      tableToSquare,
      tablePromotion,
    ),
  );

  const openingAlpha = alpha;
  let best = -Infinity;
  let bestFrom = -1;
  let bestTo = -1;
  let bestPromotion: PromotionPiece | null = null;

  for (let index = 0; index < moves.length; index += 1) {
    selectMove(moves, scores, index);
    const move = moves[index]!;
    const quiet = move.captured === null && move.promotion === null;

    let reduction = 0;
    if (depth >= 3 && index >= 3 && quiet && !inCheck) {
      reduction = index >= 6 ? 2 : 1;
      if (reduction > depth - 2) {
        reduction = depth - 2;
      }
    }

    const child = applyMove(position, move);
    let score: number;

    if (index === 0) {
      score = -negamax(
        state,
        child,
        depth - 1,
        -beta,
        -alpha,
        ply + 1,
        true,
        extensions,
      );
    } else {
      score = -negamax(
        state,
        child,
        depth - 1 - reduction,
        -alpha - 1,
        -alpha,
        ply + 1,
        true,
        extensions,
      );

      if (!state.aborted && score > alpha && (reduction > 0 || score < beta)) {
        score = -negamax(
          state,
          child,
          depth - 1,
          -beta,
          -alpha,
          ply + 1,
          true,
          extensions,
        );
      }
    }

    if (state.aborted) {
      return 0;
    }

    if (score > best) {
      best = score;
      bestFrom = move.from;
      bestTo = move.to;
      bestPromotion = move.promotion;
    }

    if (score > alpha) {
      alpha = score;
    }

    if (alpha >= beta) {
      if (quiet) {
        rememberKiller(state, ply, move);
        rememberHistory(state, move, depth);
      }
      break;
    }
  }

  store(
    key,
    depth,
    ply,
    best,
    best >= beta ? LOWER_BOUND : best > openingAlpha ? EXACT : UPPER_BOUND,
    bestFrom,
    bestTo,
    bestPromotion,
  );

  return best;
}

export function principalVariation(position: Position, first: Move): Move[] {
  const line: Move[] = [first];
  const seen = new Set<number>();
  let current = applyMove(position, first);

  while (line.length < MAX_PLY) {
    const key = hashPosition(current);
    if (seen.has(key) || !probe(key, 0) || probed.from < 0) {
      break;
    }
    seen.add(key);

    const move = findMove(
      generateLegalMoves(current),
      probed.from,
      probed.to,
      probed.promotion ?? undefined,
    );

    if (!move) {
      break;
    }

    line.push(move);
    current = applyMove(current, move);
  }

  return line;
}
