import { evaluate } from "./evaluate";
import {
  findMove,
  generateLegalMoves,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { chooseBookMove } from "./opening-book";
import {
  personalityFor,
  searchLimitsFor,
  type Difficulty,
  type Personality,
  type PersonalityId,
} from "./personality";
import { MATE_SCORE, MATE_THRESHOLD, search } from "./search";
import type { Color, Move, Position } from "./types";

/**
 * The engine's two jobs: choosing a move to play, and saying what it thinks of a
 * position afterwards. Both run the same search — see `search.ts` — on different
 * budgets, because the two want different things from it. A move has to arrive
 * before the player's patience or their clock runs out, so it is bounded by time
 * and takes whatever depth the machine can manage. A review has no one waiting on
 * it but must agree with itself: analyse the same game twice and the accuracy
 * figures should match, which a search bounded by a clock could never promise.
 */

export type { Difficulty, Personality, PersonalityId };
export {
  DEFAULT_PERSONALITY,
  DIFFICULTIES,
  PERSONALITIES,
  PERSONALITY_LIST,
  PERSONALITY_ORDER,
  isPersonalityId,
  personalitiesAtTier,
  personalityFor,
  searchLimitsFor,
} from "./personality";

export type FindMoveOptions = {
  /**
   * Consult the opening book before searching. On by default; turn it off to
   * measure the search itself, which is the one caller that wants the engine's
   * own answer to a position theory has already answered.
   */
  book?: boolean;
  /**
   * Injectable randomness, so a test can pin which move a bot slips into and
   * which line it opens with. Must return a value in [0, 1) like `Math.random`.
   */
  random?: () => number;
};

/**
 * Pick a move for the side to move. Returns null when there is no legal move.
 *
 * `history` is the positions the game has already been in, oldest first, so the
 * engine can tell a repetition from a fresh position: without it a bot in a won
 * game will happily check the same king back and forth until the fifty-move rule
 * takes the win off it.
 *
 * The order below is the whole of what makes one bot different from another.
 *
 * A slip comes first, because a bot that is meant to be beatable has to go
 * wrong *somewhere*, and it may as well be able to go wrong in the opening too.
 * The Rookie slips on every move, which is what makes it play at random without
 * needing a case of its own — and which is the point of it: a beginner's
 * opponent that opens with ten plies of the Najdorf and then hangs its queen is
 * a worse teacher than one that is bad throughout.
 *
 * Then the book, while the game is still in it. That is worth more than the
 * plies it saves: a search on an opening budget picks the move that looks best
 * three moves out, which in the opening is how an engine talks itself into the
 * same slightly-off line every game. Book moves are also instant, so the bot's
 * clock — and the server's event loop — only starts paying once the position is
 * genuinely its own problem. Which line it takes out of the book is where a
 * personality's taste shows first.
 *
 * Then the search, on that personality's budget and with its evaluation.
 */
export function findBestMove(
  position: Position,
  who: PersonalityId | Personality,
  history: readonly Position[] = [],
  options: FindMoveOptions = {},
): Move | null {
  const moves = generateLegalMoves(position);
  if (moves.length === 0) {
    return null;
  }

  const personality = typeof who === "string" ? personalityFor(who) : who;
  const random = options.random ?? Math.random;

  if (personality.slipChance > 0 && random() < personality.slipChance) {
    return moves[Math.floor(random() * moves.length)] ?? null;
  }

  if (options.book ?? true) {
    const fromBook = chooseBookMove(position, {
      random,
      style: personality.opening,
    });
    if (fromBook) {
      return (
        findMove(
          moves,
          fromBook.from,
          fromBook.to,
          fromBook.promotion ?? undefined,
        ) ?? fromBook
      );
    }
  }

  return search(position, searchLimitsFor(personality), history).bestMove;
}

/**
 * The same engine turned inward, for reviewing a game rather than playing one.
 *
 * `analyzePosition` reports what the search thinks of a position; `centipawnLoss`
 * turns a pair of those verdicts into how much a move gave away, and
 * `classifyMove` labels that loss the way an analysis board does. All scores are
 * centipawns from *white's* point of view — positive favours white — so the
 * whole game reads on one axis rather than flipping with the side to move.
 */

/** The depth a review will not search past. */
export const ANALYSIS_DEPTH = 8;

/**
 * The positions one review may visit, which is what actually stops it — the depth
 * above is only a ceiling. A node count rather than a time limit because it is
 * the same number on every machine: two reviews of the same game agree, and the
 * accuracy on a shared game means the same thing to everyone who opens it.
 *
 * Worth about five plies in a middlegame, and around sixty milliseconds. The
 * analysis screen works through a game one position per render tick, so this is
 * also the size of the pause between keystrokes while it runs — which is what
 * stops it from being set higher.
 */
const ANALYSIS_NODES = 8_000;

export type MoveQuality =
  | "best"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export type Analysis = {
  /** Centipawns from white's POV; positive favours white. */
  scoreCp: number;
  /**
   * Moves until forced mate — positive when white is mating, negative when
   * black is — or null when neither side has one in view.
   */
  mateIn: number | null;
  /** The move the search would play, or null in a terminal position. */
  bestMove: Move | null;
};

/**
 * Static evaluation in centipawns from white's point of view. `evaluate` scores
 * from the side to move's perspective, the way negamax needs; this flips it so
 * callers get one consistent axis.
 */
export function evaluatePosition(position: Position): number {
  const score = evaluate(position);
  return position.turn === "w" ? score : -score;
}

/** Search `position` and report the verdict, white's POV. */
export function analyzePosition(
  position: Position,
  depth: number = ANALYSIS_DEPTH,
): Analysis {
  const moves = generateLegalMoves(position);

  // A terminal position has no move to recommend: checkmate is a decisive
  // score for whoever delivered it, any other end is a dead-level draw.
  if (moves.length === 0) {
    if (isInCheck(position, position.turn)) {
      const whiteMated = position.turn === "w";
      return {
        scoreCp: whiteMated ? -MATE_SCORE : MATE_SCORE,
        // The mate is already on the board — zero moves away, either side.
        mateIn: 0,
        bestMove: null,
      };
    }
    return { scoreCp: 0, mateIn: null, bestMove: null };
  }

  if (position.halfmoveClock >= 100 || isInsufficientMaterial(position)) {
    return { scoreCp: 0, mateIn: null, bestMove: null };
  }

  const result = search(position, { depth, nodes: ANALYSIS_NODES });

  // `result.score` is from the side to move's POV; flip it to white's.
  const whiteScore = position.turn === "w" ? result.score : -result.score;

  let mateIn: number | null = null;
  if (Math.abs(result.score) >= MATE_THRESHOLD) {
    const plies = MATE_SCORE - Math.abs(result.score);
    const movesToMate = Math.max(1, Math.ceil(plies / 2));
    // The side to move is mating when its score is positive.
    const whiteMating = result.score > 0 === (position.turn === "w");
    mateIn = whiteMating ? movesToMate : -movesToMate;
  }

  return { scoreCp: whiteScore, mateIn, bestMove: result.bestMove };
}

/**
 * How much the mover gave up, in centipawns, given the white-POV evaluation
 * before and after their move. A move that keeps the evaluation where it stood
 * loses nothing; one that hands the opponent an edge loses the difference.
 * Never negative — a move that happens to out-search the reference position (a
 * shallow search finding more on the reply) is not a "gain", it is noise.
 */
export function centipawnLoss(
  mover: Color,
  whiteEvalBefore: number,
  whiteEvalAfter: number,
): number {
  const delta =
    mover === "w"
      ? whiteEvalBefore - whiteEvalAfter
      : whiteEvalAfter - whiteEvalBefore;
  return Math.max(0, delta);
}

/**
 * Thresholds in centipawns. Generous at the top — a review that searches deeper
 * than the game was played should not brand every third move an inaccuracy — and
 * unmistakable at the bottom, where a blunder is a piece or a lost game.
 */
export function classifyMove(centipawnLoss: number): MoveQuality {
  if (centipawnLoss <= 20) {
    return "best";
  }
  if (centipawnLoss <= 60) {
    return "good";
  }
  if (centipawnLoss <= 120) {
    return "inaccuracy";
  }
  if (centipawnLoss <= 250) {
    return "mistake";
  }
  return "blunder";
}
