import type { EvalWeights } from "../evaluate";
import type { Move } from "../types";

export const MATE_SCORE = 100_000;

export const MATE_THRESHOLD = MATE_SCORE - 1000;

export const DRAW_SCORE = 0;

export const MAX_PLY = 64;

export const MAX_QUIESCENCE_PLY = 8;

export const DELTA_MARGIN = 150;

export const MAX_EXTENSIONS = 6;

export const DEFAULT_NODES = 50_000;

export type SearchLimits = {
  depth?: number;
  timeMs?: number;
  nodes?: number;
  randomize?: boolean;
  weights?: EvalWeights;
  contempt?: number;
};

export type SearchResult = {
  bestMove: Move | null;
  score: number;
  depth: number;
  nodes: number;
  pv: Move[];
};
