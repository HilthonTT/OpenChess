import { EVAL_TERMS, type EvalWeights } from "../evaluate";
import type { Color } from "../types";
import { linearScore } from "./weights";

export type Leaf =
  | { kind: "features"; features: Float64Array }
  | { kind: "fixed"; value: number };

export type Outcome = -1 | 0 | 1;

export type TdLeafOptions = {
  lambda: number;
  scale: number;
};

export const DEFAULT_TD_LEAF: TdLeafOptions = { lambda: 0.7, scale: 400 };

export function leafValue(
  leaf: Leaf,
  learner: Color,
  weights: EvalWeights,
  scale: number,
): number {
  if (leaf.kind === "fixed") {
    return leaf.value;
  }
  const sign = learner === "w" ? 1 : -1;
  return Math.tanh((sign * linearScore(leaf.features, weights)) / scale);
}

export function tdLeafGradient(
  leaves: readonly Leaf[],
  outcome: Outcome,
  learner: Color,
  weights: EvalWeights,
  options: TdLeafOptions = DEFAULT_TD_LEAF,
): Float64Array {
  const gradient = new Float64Array(EVAL_TERMS.length);
  const sign = learner === "w" ? 1 : -1;

  const values = leaves.map((leaf) =>
    leafValue(leaf, learner, weights, options.scale),
  );

  let trace = 0;
  for (let t = leaves.length - 1; t >= 0; t -= 1) {
    const next = t + 1 < leaves.length ? values[t + 1]! : outcome;
    const value = values[t]!;
    trace = next - value + options.lambda * trace;

    const leaf = leaves[t]!;
    if (leaf.kind === "fixed") {
      continue;
    }

    const slope = ((1 - value * value) * sign) / options.scale;
    for (let index = 0; index < gradient.length; index += 1) {
      gradient[index]! += slope * leaf.features[index]! * trace;
    }
  }

  return gradient;
}
