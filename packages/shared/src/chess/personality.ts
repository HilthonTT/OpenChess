import { DEFAULT_EVAL_WEIGHTS, type EvalWeights } from "./evaluate";
import type { OpeningStyle } from "./opening-lines";
import type { SearchLimits } from "./search";

/**
 * The bots.
 *
 * A difficulty slider answers "how hard is this to beat" and nothing else, so
 * three of them is three of the same opponent at three speeds. What actually
 * makes a bot worth playing twice is that it wants something — and the engine
 * next door already has every lever needed to give it one: what the evaluation
 * cares about (`EvalWeights`), what it opens with (`OpeningStyle`), whether it
 * will take a draw (`contempt`), and how often it simply goes wrong.
 *
 * So a personality is a *style* and a *strength* together. Strength still maps
 * onto the three tiers, because that is what the rewards and the rating are
 * scaled by and those should not shift because a bot changed its opening
 * repertoire — beating a hard bot is worth the same whichever hard bot it was.
 *
 * The Elo figures are estimates for the picker, not ratings anything earned.
 * They are what the tier's search budget is worth, adjusted down for a bot that
 * is told to blunder.
 */

/** The reward and rating tier a personality plays at. */
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
  /** One line for the picker; kept short enough not to wrap the setup screen. */
  blurb: string;
  /** A rough playing strength, for the picker. Not a rating it has earned. */
  elo: number;
  /** Which tier its rewards, rating change and achievements are scaled by. */
  tier: Difficulty;
  /** What it is trying to do, in the terms `evaluate` understands. */
  weights: EvalWeights;
  /** What it spends on a move. */
  limits: Omit<SearchLimits, "weights" | "contempt">;
  /**
   * Centipawns a draw is worth *less* than nothing to it: positive plays on,
   * negative takes the half point.
   */
  contempt: number;
  /**
   * How often it plays a random legal move instead of the one it found, per
   * move. The blunt weakening, and the honest one — a bot that is meant to be
   * beatable has to actually go wrong somewhere, and going wrong occasionally
   * and badly is much closer to how a weaker player loses than playing every
   * move slightly less well would be.
   */
  slipChance: number;
  /** The theory it leans on, or null to play the book straight. */
  opening: OpeningStyle | null;
};

/** `DEFAULT_EVAL_WEIGHTS` with the named terms overridden. */
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
    // Never consulted: a slip chance of 1 means the search is never reached.
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
    // Material discounted and activity paid for: enough that a pawn for two
    // developing moves reads as a good trade without anyone naming a gambit.
    // The king shield is discounted too, since a bot that will not loosen its
    // own kingside cannot play this way for long.
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
    // The one bot that would rather draw than risk losing.
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
    // Plays on in positions most engines would shake hands in, which is the
    // whole point of it: a level rook ending against this one is still a game.
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

/** Every personality, weakest first — the order a picker should show them in. */
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

/**
 * What to play as when all that is known is a tier — a game recorded before
 * personalities existed, or one created by something that only speaks
 * difficulty. Each tier's most characterless bot, so a game that never chose a
 * personality does not get handed a strong opinion by default.
 */
export const DEFAULT_PERSONALITY: Record<Difficulty, PersonalityId> = {
  easy: "rookie",
  medium: "fortress",
  hard: "maestro",
};

/** The personality `id` names, falling back to `tier`'s default. */
export function personalityFor(
  id: string | null | undefined,
  tier: Difficulty = "medium",
): Personality {
  if (id && isPersonalityId(id)) {
    return PERSONALITIES[id];
  }
  return PERSONALITIES[DEFAULT_PERSONALITY[tier]];
}

/** The personalities that play at `tier`. */
export function personalitiesAtTier(tier: Difficulty): Personality[] {
  return PERSONALITY_LIST.filter((personality) => personality.tier === tier);
}

/** The full search limits for a personality: its budget, its taste, its contempt. */
export function searchLimitsFor(personality: Personality): SearchLimits {
  return {
    ...personality.limits,
    weights: personality.weights,
    contempt: personality.contempt,
  };
}
