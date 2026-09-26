import { describe, expect, test } from "bun:test";
import { parseFen, STARTING_FEN } from "../board";
import {
  DEFAULT_EVAL_WEIGHTS,
  EVAL_FEATURE_COUNT,
  EVAL_TERMS,
  evaluate,
  evaluationFeatures,
} from "../evaluate";
import { applyMove, generateLegalMoves } from "../moves";
import { PERSONALITY_LIST } from "../personality";
import type { Position } from "../types";
import { eloDifference, tallyMatch } from "./match";
import { playTrainingGame } from "./self-play";
import { type Leaf, tdLeafGradient } from "./td-leaf";
import {
  clampWeights,
  linearScore,
  MAX_WEIGHT,
  MIN_WEIGHT,
  vectorToWeights,
  weightsToVector,
} from "./weights";

function randomPositions(count: number): Position[] {
  let seed = 11;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const positions: Position[] = [];
  let position = parseFen(STARTING_FEN);
  while (positions.length < count) {
    const moves = generateLegalMoves(position);
    if (moves.length === 0 || position.halfmoveClock > 60) {
      position = parseFen(STARTING_FEN);
      continue;
    }
    position = applyMove(position, moves[Math.floor(random() * moves.length)]!);
    positions.push(position);
  }
  return positions;
}

function featuresLeaf(values: number[]): Leaf {
  const features = new Float64Array(EVAL_FEATURE_COUNT);
  features.set(values);
  return { kind: "features", features };
}

describe("evaluationFeatures", () => {
  const positions = randomPositions(400);

  test("dotted with every personality's weights, gives evaluate()", () => {
    for (const personality of PERSONALITY_LIST) {
      for (const position of positions) {
        const features = evaluationFeatures(position);
        const white = linearScore(features, personality.weights);
        const expected = evaluate(position, personality.weights);
        const fromMover = position.turn === "w" ? white : -white;
        expect(Math.abs(fromMover - expected)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  test("is zero at the start, where both sides are equal", () => {
    const features = evaluationFeatures(parseFen(STARTING_FEN));
    for (const value of features) {
      expect(value).toBe(0);
    }
  });

  test("counts the extra queen as material", () => {
    const up = parseFen("4k3/8/8/8/8/8/8/3QK3 w - - 0 1");
    const features = evaluationFeatures(up);
    expect(features[EVAL_TERMS.indexOf("material")]).toBe(900);
  });
});

describe("weights", () => {
  test("round-trip through a vector", () => {
    const vector = weightsToVector(DEFAULT_EVAL_WEIGHTS);
    expect(vector.length).toBe(EVAL_TERMS.length);
    expect(vectorToWeights(vector)).toEqual({ ...DEFAULT_EVAL_WEIGHTS });
  });

  test("are clamped into range", () => {
    const clamped = clampWeights({
      ...DEFAULT_EVAL_WEIGHTS,
      material: -3,
      kingSafety: 99,
    });
    expect(clamped.material).toBe(MIN_WEIGHT);
    expect(clamped.kingSafety).toBe(MAX_WEIGHT);
  });
});

describe("tdLeafGradient", () => {
  const options = { lambda: 0.7, scale: 400 };

  test("does not move when the predictions were already right", () => {
    const leaves: Leaf[] = [
      { kind: "fixed", value: 1 },
      { kind: "fixed", value: 1 },
    ];
    const gradient = tdLeafGradient(
      leaves,
      1,
      "w",
      DEFAULT_EVAL_WEIGHTS,
      options,
    );
    expect(Array.from(gradient)).toEqual(new Array(EVAL_TERMS.length).fill(0));
  });

  test("trusts material less after losing a game it thought it was winning", () => {
    const leaves = [featuresLeaf([300]), featuresLeaf([300])];
    const gradient = tdLeafGradient(
      leaves,
      -1,
      "w",
      DEFAULT_EVAL_WEIGHTS,
      options,
    );
    expect(gradient[EVAL_TERMS.indexOf("material")]).toBeLessThan(0);
  });

  test("reads the features from the learner's side as black", () => {
    const leaves = [featuresLeaf([-300])];
    const gradient = tdLeafGradient(
      leaves,
      1,
      "b",
      DEFAULT_EVAL_WEIGHTS,
      options,
    );
    expect(gradient[EVAL_TERMS.indexOf("material")]).toBeGreaterThan(0);
  });

  test("blames earlier moves by λ", () => {
    const leaves = [featuresLeaf([100]), { kind: "fixed", value: 0 } as Leaf];
    const blind = tdLeafGradient(leaves, -1, "w", DEFAULT_EVAL_WEIGHTS, {
      ...options,
      lambda: 0,
    });
    const full = tdLeafGradient(leaves, -1, "w", DEFAULT_EVAL_WEIGHTS, {
      ...options,
      lambda: 1,
    });

    const value = Math.tanh(100 / 400);
    const slope = (1 - value * value) / 400;
    expect(blind[0]).toBeCloseTo(slope * 100 * (0 - value), 10);
    expect(full[0]).toBeCloseTo(slope * 100 * (-1 - value), 10);
  });
});

describe("playTrainingGame", () => {
  test("records one leaf per learner move and ends with an outcome", () => {
    const game = playTrainingGame({
      learner: { weights: DEFAULT_EVAL_WEIGHTS },
      opponent: { weights: DEFAULT_EVAL_WEIGHTS },
      learnerColor: "w",
      limits: { depth: 1 },
      maxPlies: 30,
    });

    expect([-1, 0, 1]).toContain(game.outcome);
    expect(game.plies).toBeLessThanOrEqual(30);
    expect(game.leaves.length).toBeGreaterThan(0);
    expect(game.leaves.length).toBeLessThanOrEqual(Math.ceil(game.plies / 2));
  });

  test("finds the mate in one and scores it as a win", () => {
    const game = playTrainingGame({
      learner: { weights: DEFAULT_EVAL_WEIGHTS },
      opponent: { weights: DEFAULT_EVAL_WEIGHTS },
      learnerColor: "w",
      limits: { depth: 2 },
      fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1",
    });

    expect(game.status).toBe("checkmate");
    expect(game.outcome).toBe(1);
    expect(game.plies).toBe(1);
    expect(game.leaves).toEqual([{ kind: "fixed", value: 1 }]);
  });

  test("records nothing when asked not to", () => {
    const game = playTrainingGame({
      learner: { weights: DEFAULT_EVAL_WEIGHTS },
      opponent: { weights: DEFAULT_EVAL_WEIGHTS },
      learnerColor: "b",
      limits: { depth: 1 },
      maxPlies: 10,
      record: false,
    });
    expect(game.leaves).toEqual([]);
  });
});

describe("match", () => {
  test("an even score is an even rating", () => {
    expect(eloDifference(0.5)).toBe(0);
    expect(eloDifference(0.75)).toBeCloseTo(190.85, 1);
    expect(eloDifference(1)).toBe(800);
  });

  test("tallies wins, draws and losses", () => {
    expect(tallyMatch([1, 1, 0, -1])).toMatchObject({
      games: 4,
      wins: 2,
      draws: 1,
      losses: 1,
      score: 0.625,
    });
  });
});
