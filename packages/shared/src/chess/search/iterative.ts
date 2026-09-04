import { DEFAULT_EVAL_WEIGHTS } from "../evaluate";
import { applyMove, generateLegalMoves } from "../moves";
import { hashPosition } from "../zobrist";
import type { Move, Position } from "../types";

import {
  DEFAULT_NODES,
  MATE_THRESHOLD,
  MAX_PLY,
  type SearchLimits,
  type SearchResult,
} from "./constants";
import { negamax, principalVariation } from "./negamax";
import { reorderByScore, shuffle } from "./ordering";
import type { SearchState } from "./state";
import { beginGeneration } from "./transposition";

export function search(
  position: Position,
  limits: SearchLimits = {},
  history: readonly Position[] = [],
): SearchResult {
  beginGeneration();

  const reversible = Math.min(position.halfmoveClock, history.length);
  const before: number[] = [];
  for (
    let index = history.length - reversible;
    index < history.length;
    index += 1
  ) {
    before.push(hashPosition(history[index]!));
  }

  const unbounded =
    limits.nodes === undefined &&
    limits.depth === undefined &&
    limits.timeMs === undefined;

  const state: SearchState = {
    nodes: 0,
    nodeLimit: limits.nodes ?? (unbounded ? DEFAULT_NODES : Infinity),
    deadline:
      limits.timeMs === undefined ? Infinity : Date.now() + limits.timeMs,
    aborted: false,
    path: new Float64Array(MAX_PLY + 1),
    before,
    killers: new Int32Array(MAX_PLY * 2).fill(-1),
    history: new Int32Array(64 * 64),
    weights: limits.weights ?? DEFAULT_EVAL_WEIGHTS,
    rootTurn: position.turn,
    contempt: limits.contempt ?? 0,
  };

  const moves = generateLegalMoves(position);
  if (moves.length === 0) {
    return { bestMove: null, score: 0, depth: 0, nodes: 0, pv: [] };
  }

  if (limits.randomize === true) {
    shuffle(moves);
  }

  state.path[0] = hashPosition(position);

  const maxDepth = Math.min(limits.depth ?? MAX_PLY - 1, MAX_PLY - 1);
  const scores: number[] = moves.map(() => -Infinity);

  let bestMove = moves[0]!;
  let bestScore = 0;
  let reachedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let alpha = -Infinity;
    let iterationBest: Move | null = null;
    let iterationScore = -Infinity;

    for (let index = 0; index < moves.length; index += 1) {
      const move = moves[index]!;
      const child = applyMove(position, move);

      let score: number;
      if (index === 0) {
        score = -negamax(
          state,
          child,
          depth - 1,
          -Infinity,
          -alpha,
          1,
          true,
          0,
        );
      } else {
        score = -negamax(
          state,
          child,
          depth - 1,
          -alpha - 1,
          -alpha,
          1,
          true,
          0,
        );
        if (!state.aborted && score > alpha) {
          score = -negamax(
            state,
            child,
            depth - 1,
            -Infinity,
            -alpha,
            1,
            true,
            0,
          );
        }
      }

      if (state.aborted) {
        break;
      }

      scores[index] = score;

      if (score > iterationScore) {
        iterationScore = score;
        iterationBest = move;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    if (iterationBest !== null) {
      bestMove = iterationBest;
      bestScore = iterationScore;
      reachedDepth = depth;
    }

    if (state.aborted) {
      break;
    }

    if (Math.abs(bestScore) >= MATE_THRESHOLD || moves.length === 1) {
      break;
    }

    reorderByScore(moves, scores);
  }

  return {
    bestMove,
    score: bestScore,
    depth: reachedDepth,
    nodes: state.nodes,
    pv: principalVariation(position, bestMove),
  };
}
