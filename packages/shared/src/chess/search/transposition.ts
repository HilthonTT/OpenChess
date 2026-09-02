import type { PromotionPiece } from "../types";

import { MATE_THRESHOLD } from "./constants";

/* -------------------------------------------------------------------------- */
/* Transposition table                                                        */
/* -------------------------------------------------------------------------- */

/**
 * One shared, fixed-size table rather than a `Map` per search: a table of
 * parallel typed arrays costs nothing to allocate, never grows, and — most of
 * all — never asks the garbage collector to walk a million entries in the middle
 * of a search.
 *
 * 2^18 entries is about five megabytes and comfortably more slots than a
 * one-second search visits positions.
 */
const TABLE_SIZE = 1 << 18;

const TABLE_MASK = TABLE_SIZE - 1;

const NO_ENTRY = 0;

/** The score is the true value of the position. */
export const EXACT = 1;

/** The search cut off: the true value is at least this. */
export const LOWER_BOUND = 2;

/** Nothing beat alpha: the true value is at most this. */
export const UPPER_BOUND = 3;

const tableKeys = new Float64Array(TABLE_SIZE);

const tableScores = new Int32Array(TABLE_SIZE);

const tableDepths = new Int8Array(TABLE_SIZE);

const tableFlags = new Uint8Array(TABLE_SIZE);

const tableFrom = new Int8Array(TABLE_SIZE);

const tableTo = new Int8Array(TABLE_SIZE);

const tablePromotions = new Uint8Array(TABLE_SIZE);

const tableGenerations = new Int32Array(TABLE_SIZE);

/**
 * Bumped once per top-level search. An entry from an older generation is ignored,
 * which clears the table in constant time — and keeps each search independent of
 * whatever was searched before it, so the same call twice gives the same answer.
 *
 * Kept inside the range an `Int32Array` can hold, and never allowed back to zero,
 * which is what an untouched slot reads as. Left to grow it would eventually
 * exceed what the array stores, no slot would ever match again, and the table
 * would quietly stop working rather than fail.
 */
let generation = 0;

/** Retire every entry from the last search by moving the table on a generation. */
export function beginGeneration(): void {
  generation = generation >= 0x7fffffff ? 1 : generation + 1;
}

const PROMOTION_CODES: readonly (PromotionPiece | null)[] = [
  null,
  "q",
  "r",
  "b",
  "n",
];

function promotionCode(promotion: PromotionPiece | null): number {
  return promotion === null ? 0 : PROMOTION_CODES.indexOf(promotion);
}

/**
 * Where `probe` leaves what it found. A single reused object rather than a
 * return value, because a probe happens at nearly every node and the allocation
 * would show up. Callers must copy anything they still need across a recursive
 * call, which will have overwritten it.
 */
export const probed = {
  score: 0,
  depth: 0,
  flag: NO_ENTRY,
  from: -1,
  to: -1,
  promotion: null as PromotionPiece | null,
};

/**
 * Look `key` up. Mate scores are stored relative to the node that found them —
 * "mate in three from here" — because the same entry can be reached at a
 * different distance from the root, where "mate in three from the root" would be
 * a different claim. Reading one converts it back.
 */
export function probe(key: number, ply: number): boolean {
  const slot = key & TABLE_MASK;

  if (tableGenerations[slot] !== generation || tableKeys[slot] !== key) {
    return false;
  }

  let score = tableScores[slot]!;
  if (score >= MATE_THRESHOLD) {
    score -= ply;
  } else if (score <= -MATE_THRESHOLD) {
    score += ply;
  }

  probed.score = score;
  probed.depth = tableDepths[slot]!;
  probed.flag = tableFlags[slot]!;
  probed.from = tableFrom[slot]!;
  probed.to = tableTo[slot]!;
  probed.promotion = PROMOTION_CODES[tablePromotions[slot]!] ?? null;

  return probed.flag !== NO_ENTRY;
}

export function store(
  key: number,
  depth: number,
  ply: number,
  score: number,
  flag: number,
  from: number,
  to: number,
  promotion: PromotionPiece | null,
): void {
  const slot = key & TABLE_MASK;

  // A deeper answer from this same search is worth more than a shallower one.
  // Anything from an earlier search is stale and free to overwrite.
  if (tableGenerations[slot] === generation && tableDepths[slot]! > depth) {
    return;
  }

  let stored = score;
  if (score >= MATE_THRESHOLD) {
    stored = score + ply;
  } else if (score <= -MATE_THRESHOLD) {
    stored = score - ply;
  }

  tableKeys[slot] = key;
  tableScores[slot] = stored;
  tableDepths[slot] = depth;
  tableFlags[slot] = flag;
  tableFrom[slot] = from;
  tableTo[slot] = to;
  tablePromotions[slot] = promotionCode(promotion);
  tableGenerations[slot] = generation;
}
