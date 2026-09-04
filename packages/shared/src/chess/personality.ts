import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "./evaluate";
import type { OpeningStyle } from "./opening-lines";
import type { SearchLimits } from "./search";

export type Difficulty = "easy" | "medium" | "hard";

export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export type PersonalityId =
  | "rookie"
  | "gambiteer"
  | "fortress"
  | "tactician"
  | "grinder"
  | "maestro";

export type Personality = {
  id: PersonalityId;
  name: string;
  blurb: string;
  elo: number;
  tier: Difficulty;
  weights: EvalWeights;
  limits: Omit<SearchLimits, "weights" | "contempt">;
  contempt: number;
  slipChance: number;
  opening: OpeningStyle | null;
};

function weights(overrides: Partial<EvalWeights>): EvalWeights {
  return { ...DEFAULT_EVAL_WEIGHTS, ...overrides };
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  rookie: {
    id: "rookie",
    name: "Rookie",
    blurb: "Plays whatever comes to mind. Everyone starts somewhere.",
    elo: 400,
    tier: "easy",
    weights: DEFAULT_EVAL_WEIGHTS,
    limits: {},
    contempt: 0,
    slipChance: 1,
    opening: null,
  },

  gambiteer: {
    id: "gambiteer",
    name: "Gambiteer",
    blurb: "Gives up pawns for the initiative, and means it.",
    elo: 1100,
    tier: "medium",
    weights: weights({
      material: 0.82,
      pieceSquares: 1.3,
      pawnStructure: 0.55,
      kingSafety: 0.7,
    }),
    limits: { depth: 4, timeMs: 300, randomize: true },
    contempt: 25,
    slipChance: 0.06,
    opening: "gambit",
  },

  fortress: {
    id: "fortress",
    name: "Fortress",
    blurb: "Trades the fireworks for a structure you cannot break.",
    elo: 1150,
    tier: "medium",
    weights: weights({
      material: 1.1,
      pieceSquares: 0.85,
      pawnStructure: 1.7,
      kingSafety: 1.9,
      rookFiles: 0.8,
    }),
    limits: { depth: 4, timeMs: 300, randomize: true },
    contempt: -20,
    slipChance: 0.05,
    opening: "solid",
  },

  tactician: {
    id: "tactician",
    name: "Tactician",
    blurb:
      "Hunts for the tactic, and keeps the position sharp enough to have one.",
    elo: 1650,
    tier: "hard",
    weights: weights({
      material: 0.95,
      pieceSquares: 1.15,
      kingSafety: 1.25,
      pawnStructure: 0.8,
    }),
    limits: { timeMs: 600, randomize: true },
    contempt: 15,
    slipChance: 0,
    opening: "sharp",
  },

  grinder: {
    id: "grinder",
    name: "Grinder",
    blurb: "Swaps down, pushes a pawn, and will not agree to anything.",
    elo: 1600,
    tier: "hard",
    weights: weights({
      material: 1.05,
      passedPawns: 1.8,
      pawnStructure: 1.35,
      bishopPair: 1.25,
      pieceSquares: 0.9,
    }),
    limits: { timeMs: 600, randomize: true },
    contempt: 45,
    slipChance: 0,
    opening: "classical",
  },

  maestro: {
    id: "maestro",
    name: "Maestro",
    blurb: "No preferences, no mercy. The engine as it comes.",
    elo: 1750,
    tier: "hard",
    weights: DEFAULT_EVAL_WEIGHTS,
    limits: { timeMs: 600, randomize: true },
    contempt: 0,
    slipChance: 0,
    opening: null,
  },
};

export const PERSONALITY_ORDER: PersonalityId[] = [
  "rookie",
  "gambiteer",
  "fortress",
  "grinder",
  "tactician",
  "maestro",
];

export const PERSONALITY_LIST: Personality[] = PERSONALITY_ORDER.map(
  (id) => PERSONALITIES[id],
);

export function isPersonalityId(value: string): value is PersonalityId {
  return value in PERSONALITIES;
}

export const DEFAULT_PERSONALITY: Record<Difficulty, PersonalityId> = {
  easy: "rookie",
  medium: "fortress",
  hard: "maestro",
};

export function personalityFor(
  id: string | null | undefined,
  tier: Difficulty = "medium",
): Personality {
  if (id && isPersonalityId(id)) {
    return PERSONALITIES[id];
  }
  return PERSONALITIES[DEFAULT_PERSONALITY[tier]];
}

export function personalitiesAtTier(tier: Difficulty): Personality[] {
  return PERSONALITY_LIST.filter((personality) => personality.tier === tier);
}

export function searchLimitsFor(personality: Personality): SearchLimits {
  return {
    ...personality.limits,
    weights: personality.weights,
    contempt: personality.contempt,
  };
}
