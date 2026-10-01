import { EVAL_FEATURE_COUNT, EVAL_TERMS, type EvalWeights } from "../evaluate";

export const MIN_WEIGHT = 0.05;
export const MAX_WEIGHT = 4;

export function weightsToVector(weights: EvalWeights): Float64Array {
  const vector = new Float64Array(EVAL_TERMS.length);
  for (const [index, term] of EVAL_TERMS.entries()) {
    vector[index] = weights[term];
  }
  return vector;
}

export function vectorToWeights(vector: ArrayLike<number>): EvalWeights {
  const weights = {} as EvalWeights;
  for (const [index, term] of EVAL_TERMS.entries()) {
    weights[term] = vector[index] ?? 1;
  }
  return weights;
}

export function clampWeights(weights: EvalWeights): EvalWeights {
  const clamped = {} as EvalWeights;
  for (const term of EVAL_TERMS) {
    clamped[term] = Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, weights[term]));
  }
  return clamped;
}

export function roundWeights(weights: EvalWeights, places = 3): EvalWeights {
  const factor = 10 ** places;
  const rounded = {} as EvalWeights;
  for (const term of EVAL_TERMS) {
    rounded[term] = Math.round(weights[term] * factor) / factor;
  }
  return rounded;
}

export function linearScore(
  features: Float64Array,
  weights: EvalWeights,
): number {
  let score = features[EVAL_FEATURE_COUNT - 1]!;
  for (const [index, term] of EVAL_TERMS.entries()) {
    score += features[index]! * weights[term];
  }
  return score;
}
