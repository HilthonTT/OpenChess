import type { PromotionPiece } from "../types";

import { MATE_THRESHOLD } from "./constants";

const TABLE_SIZE = 1 << 18;

const TABLE_MASK = TABLE_SIZE - 1;

const NO_ENTRY = 0;

export const EXACT = 1;

export const LOWER_BOUND = 2;

export const UPPER_BOUND = 3;

const tableKeys = new Float64Array(TABLE_SIZE);

const tableScores = new Int32Array(TABLE_SIZE);

const tableDepths = new Int8Array(TABLE_SIZE);

const tableFlags = new Uint8Array(TABLE_SIZE);

const tableFrom = new Int8Array(TABLE_SIZE);

const tableTo = new Int8Array(TABLE_SIZE);

const tablePromotions = new Uint8Array(TABLE_SIZE);

const tableGenerations = new Int32Array(TABLE_SIZE);

let generation = 0;

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

export const probed = {
  score: 0,
  depth: 0,
  flag: NO_ENTRY,
  from: -1,
  to: -1,
  promotion: null as PromotionPiece | null,
};

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
