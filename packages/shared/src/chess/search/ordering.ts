import type { Move, Position, PromotionPiece } from "../types";

import { EXCHANGE_VALUES, exchangeValueOf, see } from "./exchange";
import type { SearchState } from "./state";

/* -------------------------------------------------------------------------- */
/* Move ordering                                                              */
/* -------------------------------------------------------------------------- */

const ORDER_TABLE_MOVE = 30_000_000;

const ORDER_WINNING_CAPTURE = 20_000_000;

const ORDER_FIRST_KILLER = 10_000_000;

const ORDER_SECOND_KILLER = 9_000_000;

const ORDER_LOSING_CAPTURE = -20_000_000;

/** Ceiling on a history score, so a quiet move never outranks a killer. */
const HISTORY_CAP = 1_000_000;

function packMove(move: Move): number {
  return move.from | (move.to << 6);
}

export function rememberKiller(
  state: SearchState,
  ply: number,
  move: Move,
): void {
  const packed = packMove(move);
  const slot = ply * 2;

  if (state.killers[slot] === packed) {
    return;
  }

  state.killers[slot + 1] = state.killers[slot]!;
  state.killers[slot] = packed;
}

export function rememberHistory(
  state: SearchState,
  move: Move,
  depth: number,
): void {
  // Weighted by depth: a cutoff found at the top of the tree says more about a
  // move than one found in a corner of it.
  const index = move.from * 64 + move.to;
  const score = state.history[index]! + depth * depth;
  state.history[index] = score > HISTORY_CAP ? HISTORY_CAP : score;
}

/** Most valuable victim, least valuable attacker. */
function captureOrder(move: Move): number {
  let score = 0;
  if (move.captured !== null) {
    score += 100 * exchangeValueOf(move.captured) - exchangeValueOf(move.piece);
  }
  if (move.promotion !== null) {
    score += 100 * EXCHANGE_VALUES[move.promotion];
  }
  return score;
}

export function scoreMove(
  state: SearchState,
  position: Position,
  move: Move,
  ply: number,
  tableFromSquare: number,
  tableToSquare: number,
  tablePromotion: PromotionPiece | null,
): number {
  // Whatever the table found last time is the best guess available, and it cost
  // a full search to arrive at.
  if (
    move.from === tableFromSquare &&
    move.to === tableToSquare &&
    move.promotion === tablePromotion
  ) {
    return ORDER_TABLE_MOVE;
  }

  if (move.captured !== null || move.promotion !== null) {
    const exchange = see(position, move);
    return exchange >= 0
      ? ORDER_WINNING_CAPTURE + captureOrder(move)
      : ORDER_LOSING_CAPTURE + exchange;
  }

  const packed = packMove(move);
  if (state.killers[ply * 2] === packed) {
    return ORDER_FIRST_KILLER;
  }
  if (state.killers[ply * 2 + 1] === packed) {
    return ORDER_SECOND_KILLER;
  }

  return state.history[move.from * 64 + move.to]!;
}

/**
 * Swap the best-scoring remaining move into `index`.
 *
 * A selection pass rather than a sort, because most nodes cut off on the first
 * move or two: sorting thirty moves to look at one is work thrown away.
 */
export function selectMove(
  moves: Move[],
  scores: number[],
  index: number,
): void {
  let best = index;
  for (let candidate = index + 1; candidate < moves.length; candidate += 1) {
    if (scores[candidate]! > scores[best]!) {
      best = candidate;
    }
  }

  if (best !== index) {
    const move = moves[index]!;
    moves[index] = moves[best]!;
    moves[best] = move;

    const score = scores[index]!;
    scores[index] = scores[best]!;
    scores[best] = score;
  }
}

/** Captures ordered by what they win, for the quiescence search. */
export function orderCaptures(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => captureOrder(b) - captureOrder(a));
}

export function shuffle(moves: Move[]): void {
  for (let index = moves.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const move = moves[index]!;
    moves[index] = moves[swap]!;
    moves[swap] = move;
  }
}

/** Reorder root moves best-first, carrying their scores with them. */
export function reorderByScore(moves: Move[], scores: number[]): void {
  const order = moves.map((move, index) => ({ move, score: scores[index]! }));
  order.sort((a, b) => b.score - a.score);

  for (let index = 0; index < order.length; index += 1) {
    moves[index] = order[index]!.move;
    scores[index] = order[index]!.score;
  }
}
