import type { EvalWeights } from "../evaluate";
import type { Move } from "../types";

/** Large enough to outrank any material swing, small enough to add plies to. */
export const MATE_SCORE = 100_000;

/** How close to `MATE_SCORE` a value must be to be read as a forced mate. */
export const MATE_THRESHOLD = MATE_SCORE - 1000;

/** A draw, by any of the rules that produce one. */
export const DRAW_SCORE = 0;

/**
 * The hard ceiling on how deep any line may run. Reaching it returns a static
 * score rather than recursing, which is what bounds the search when extensions
 * and a forcing sequence conspire to keep adding plies.
 */
export const MAX_PLY = 64;

/**
 * How far past the main search's horizon the capture search may run. A real
 * exchange resolves in a handful of plies; the cap exists only so that a
 * pathological position — a long forcing sequence of checks — cannot stall a
 * bullet clock.
 */
export const MAX_QUIESCENCE_PLY = 8;

/**
 * Delta-pruning margin, in centipawns. A capture is searched only if the
 * standing score plus the whole captured piece plus this much slack — enough to
 * cover the positional swing a piece-square table can contribute — could still
 * reach alpha. Roughly a minor piece of headroom.
 */
export const DELTA_MARGIN = 150;

/**
 * How many plies of check extension one line may collect. Without a cap, a
 * position where checks never run out extends forever: each extension replaces
 * the ply it consumed, so the depth counter stops falling.
 */
export const MAX_EXTENSIONS = 6;

/**
 * What a search given no limit at all is held to. Nothing stopping it means
 * deepening until `MAX_PLY`, which in a middlegame is not a wait anyone would sit
 * through — so an unbounded call gets a sane budget rather than appearing to hang.
 */
export const DEFAULT_NODES = 50_000;

export type SearchLimits = {
  /** Ceiling on iterative-deepening depth, in plies. */
  depth?: number;
  /** Wall-clock budget in milliseconds. What a played move should be bounded by. */
  timeMs?: number;
  /**
   * Ceiling on positions visited. Unlike a clock this is the same on every
   * machine, so a search bounded by nodes returns the same move every time —
   * which is what a review of a finished game wants.
   */
  nodes?: number;
  /**
   * Break exact ties at random. Two moves the search cannot separate are equally
   * good, and picking the same one every time makes the engine play the same game
   * every time.
   */
  randomize?: boolean;
  /**
   * What this engine values, if not the house default. See `EvalWeights`.
   */
  weights?: EvalWeights;
  /**
   * Centipawns a draw is worth *less* than nothing to the searching side. Zero
   * scores a draw dead level, which is the truth; a positive value makes the
   * engine play on in positions it could shake hands in, and a negative one
   * makes it take the half point when it is offered.
   *
   * Applied by whose turn it is rather than by ply count. Those are the same
   * thing — the side to move alternates with every ply — but saying it in terms
   * of the side makes it obvious that a given position always gets the same
   * draw score, which is what keeps contempt out of the transposition table's
   * hair: an entry can never be read back at the opposite parity.
   */
  contempt?: number;
};

export type SearchResult = {
  bestMove: Move | null;
  /** Centipawns from the side-to-move's point of view. */
  score: number;
  /** The deepest iteration that produced a move. */
  depth: number;
  nodes: number;
  /** The line the search expects, best move first. */
  pv: Move[];
};
