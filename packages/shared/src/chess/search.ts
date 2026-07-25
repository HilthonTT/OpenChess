import {
  fileOf,
  opposite,
  pieceColor,
  rankOf,
  squareAt,
  toPiece,
} from "./board";
import { evaluate, hasNonPawnMaterial } from "./evaluate";
import {
  BISHOP_DIRECTIONS,
  KING_DELTAS,
  KNIGHT_DELTAS,
  ROOK_DIRECTIONS,
  applyMove,
  findMove,
  generateLegalCaptures,
  generateLegalMoves,
  hasLegalMove,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { hashPosition } from "./zobrist";
import type {
  Board,
  Color,
  Move,
  PieceType,
  Position,
  PromotionPiece,
} from "./types";
import { EMPTY } from "./types";

/**
 * The search: alpha-beta over `evaluate`, and everything that makes it look
 * further than it otherwise would within a fixed budget.
 *
 * The depth a search reaches is not a matter of patience but of how many
 * positions it can decline to look at. Every part below exists to prune:
 * a transposition table so a position reached twice is scored once, move
 * ordering so the refutation is tried first and the rest cut off behind it,
 * iterative deepening so each pass has the last one's best guess to order by,
 * null moves and reductions to write off the unpromising cheaply, and a capture
 * search at the horizon so a leaf score means something.
 *
 * Scores are centipawns from the side-to-move's point of view, as negamax needs
 * them. `ply` counts from the root, so a mate found deeper scores lower than the
 * same mate found sooner and the search prefers the quick kill.
 */

/** Large enough to outrank any material swing, small enough to add plies to. */
export const MATE_SCORE = 100_000;

/** How close to `MATE_SCORE` a value must be to be read as a forced mate. */
export const MATE_THRESHOLD = MATE_SCORE - 1000;

/** A draw, by any of the rules that produce one. */
const DRAW_SCORE = 0;

/**
 * The hard ceiling on how deep any line may run. Reaching it returns a static
 * score rather than recursing, which is what bounds the search when extensions
 * and a forcing sequence conspire to keep adding plies.
 */
const MAX_PLY = 64;

/**
 * How far past the main search's horizon the capture search may run. A real
 * exchange resolves in a handful of plies; the cap exists only so that a
 * pathological position — a long forcing sequence of checks — cannot stall a
 * bullet clock.
 */
const MAX_QUIESCENCE_PLY = 8;

/**
 * Delta-pruning margin, in centipawns. A capture is searched only if the
 * standing score plus the whole captured piece plus this much slack — enough to
 * cover the positional swing a piece-square table can contribute — could still
 * reach alpha. Roughly a minor piece of headroom.
 */
const DELTA_MARGIN = 150;

/**
 * How many plies of check extension one line may collect. Without a cap, a
 * position where checks never run out extends forever: each extension replaces
 * the ply it consumed, so the depth counter stops falling.
 */
const MAX_EXTENSIONS = 6;

/**
 * What a search given no limit at all is held to. Nothing stopping it means
 * deepening until `MAX_PLY`, which in a middlegame is not a wait anyone would sit
 * through — so an unbounded call gets a sane budget rather than appearing to hang.
 */
const DEFAULT_NODES = 50_000;

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
const EXACT = 1;
/** The search cut off: the true value is at least this. */
const LOWER_BOUND = 2;
/** Nothing beat alpha: the true value is at most this. */
const UPPER_BOUND = 3;

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

function nextGeneration(): number {
  return generation >= 0x7fffffff ? 1 : generation + 1;
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
const probed = {
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
function probe(key: number, ply: number): boolean {
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

function store(
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

/* -------------------------------------------------------------------------- */
/* Static exchange evaluation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Material for weighing an exchange. The king carries a value here — unlike in
 * `evaluate`, where it cancels out — because the swap below has to understand
 * that recapturing with the king is not free.
 */
const EXCHANGE_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 10_000,
};

function valueOf(piece: string): number {
  return EXCHANGE_VALUES[piece.toLowerCase() as PieceType] ?? 0;
}

/**
 * The square of the least valuable piece of `color` attacking `square`, or -1.
 *
 * Cheapest first is what makes an exchange sequence meaningful: a defender takes
 * with its pawn before its queen, and a sequence resolved in any other order
 * would misprice the trade.
 */
function leastValuableAttacker(
  board: Board,
  square: number,
  color: Color,
): number {
  const x = fileOf(square);
  const y = rankOf(square);

  // A white pawn attacking this square stands one rank below it.
  const pawnRank = y + (color === "w" ? -1 : 1);
  if (pawnRank >= 0 && pawnRank <= 7) {
    const pawn = toPiece("p", color);
    if (x > 0 && board[squareAt(x - 1, pawnRank)] === pawn) {
      return squareAt(x - 1, pawnRank);
    }
    if (x < 7 && board[squareAt(x + 1, pawnRank)] === pawn) {
      return squareAt(x + 1, pawnRank);
    }
  }

  const knight = toPiece("n", color);
  for (const [dx, dy] of KNIGHT_DELTAS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx > 7 || ny < 0 || ny > 7) {
      continue;
    }
    if (board[squareAt(nx, ny)] === knight) {
      return squareAt(nx, ny);
    }
  }

  // The sliders are walked once per direction set, and the first piece each ray
  // meets is the only one that can attack along it — anything behind is blocked
  // until that piece is taken off, which the caller does before asking again.
  const bishop = toPiece("b", color);
  const rook = toPiece("r", color);
  const queen = toPiece("q", color);

  let queenSquare = -1;

  for (const [directions, slider] of [
    [BISHOP_DIRECTIONS, bishop],
    [ROOK_DIRECTIONS, rook],
  ] as const) {
    for (const [dx, dy] of directions) {
      let cx = x + dx;
      let cy = y + dy;

      while (cx >= 0 && cx <= 7 && cy >= 0 && cy <= 7) {
        const occupant = board[squareAt(cx, cy)];
        if (occupant !== EMPTY && occupant !== undefined) {
          if (occupant === slider) {
            return squareAt(cx, cy);
          }
          if (occupant === queen && queenSquare === -1) {
            queenSquare = squareAt(cx, cy);
          }
          break;
        }

        cx += dx;
        cy += dy;
      }
    }
  }

  if (queenSquare !== -1) {
    return queenSquare;
  }

  const king = toPiece("k", color);
  for (const [dx, dy] of KING_DELTAS) {
    const kx = x + dx;
    const ky = y + dy;
    if (kx < 0 || kx > 7 || ky < 0 || ky > 7) {
      continue;
    }
    if (board[squareAt(kx, ky)] === king) {
      return squareAt(kx, ky);
    }
  }

  return -1;
}

/**
 * Scratch space for `see`. The exchange is played out by mutating a copy of the
 * board — which is what makes the x-rays work, since taking a piece off reveals
 * whatever stood behind it — and reusing one array keeps that out of the
 * allocator's way.
 */
const exchangeBoard: Board = new Array<string>(64).fill(EMPTY) as Board;
const exchangeGains = new Int32Array(40);

/**
 * Static exchange evaluation: the material the mover comes out ahead by if every
 * capture available on the target square is played out, cheapest piece first.
 *
 * This is what tells a capture that wins a pawn and loses a rook from one that
 * simply wins a pawn, without searching either. The quiescence search uses it to
 * throw out losing captures outright, and the main search to order the rest.
 */
export function see(position: Position, move: Move): number {
  const target = move.to;

  for (let square = 0; square < 64; square += 1) {
    exchangeBoard[square] = position.board[square] ?? EMPTY;
  }

  const mover = pieceColor(move.piece);

  // What the move itself wins. An en passant capture takes a pawn that is not
  // standing on the target square, and a promotion is worth the difference
  // between the pawn that left and the piece that arrived.
  let won = move.isEnPassant
    ? EXCHANGE_VALUES.p
    : valueOf(exchangeBoard[target] ?? EMPTY);

  if (move.isEnPassant) {
    exchangeBoard[squareAt(fileOf(move.to), rankOf(move.from))] = EMPTY;
  }
  if (move.promotion !== null) {
    won += EXCHANGE_VALUES[move.promotion] - EXCHANGE_VALUES.p;
  }

  exchangeBoard[move.from] = EMPTY;
  exchangeBoard[target] =
    move.promotion !== null ? toPiece(move.promotion, mover) : move.piece;

  let depth = 0;
  exchangeGains[0] = won;
  let side = opposite(mover);

  while (depth < exchangeGains.length - 1) {
    const from = leastValuableAttacker(exchangeBoard, target, side);
    if (from === -1) {
      break;
    }

    depth += 1;
    // Taking on the target square wins whatever is standing there, against
    // everything the other side has already banked.
    exchangeGains[depth] =
      valueOf(exchangeBoard[target] ?? EMPTY) - exchangeGains[depth - 1]!;

    const attacker = exchangeBoard[from]!;
    exchangeBoard[from] = EMPTY;
    exchangeBoard[target] = attacker;
    side = opposite(side);
  }

  // Fold the sequence back. At every step the side to move could have declined
  // to continue, so a capture is only worth taking if the reply to it is worse
  // for the opponent than stopping — which is what the negated maximum says.
  while (depth > 0) {
    exchangeGains[depth - 1] = -Math.max(
      -exchangeGains[depth - 1]!,
      exchangeGains[depth]!,
    );
    depth -= 1;
  }

  return exchangeGains[0]!;
}

/* -------------------------------------------------------------------------- */
/* Move ordering                                                              */
/* -------------------------------------------------------------------------- */

const ORDER_TABLE_MOVE = 30_000_000;
const ORDER_WINNING_CAPTURE = 20_000_000;
const ORDER_FIRST_KILLER = 10_000_000;
const ORDER_SECOND_KILLER = 9_000_000;
const ORDER_LOSING_CAPTURE = -20_000_000;

/** Ceiling on a history score, so a quiet move never outranks a killer. */
const HISTORY_CAP = 1_000_000;

type SearchState = {
  nodes: number;
  nodeLimit: number;
  deadline: number;
  aborted: boolean;
  /** The position key at each ply of the line currently being searched. */
  path: Float64Array;
  /** Keys the game already passed through, for repetitions that predate the root. */
  before: readonly number[];
  /** Two quiet moves per ply that have caused a cutoff, packed `from | to << 6`. */
  killers: Int32Array;
  /** How often a quiet move has caused a cutoff anywhere, indexed `from * 64 + to`. */
  history: Int32Array;
};

function packMove(move: Move): number {
  return move.from | (move.to << 6);
}

function rememberKiller(state: SearchState, ply: number, move: Move): void {
  const packed = packMove(move);
  const slot = ply * 2;

  if (state.killers[slot] === packed) {
    return;
  }

  state.killers[slot + 1] = state.killers[slot]!;
  state.killers[slot] = packed;
}

function rememberHistory(state: SearchState, move: Move, depth: number): void {
  // Weighted by depth: a cutoff found at the top of the tree says more about a
  // move than one found in a corner of it.
  const index = move.from * 64 + move.to;
  const score = state.history[index]! + depth * depth;
  state.history[index] = score > HISTORY_CAP ? HISTORY_CAP : score;
}

/** Most valuable victim, least valuable attacker. */
function captureOrder(move: Move): number {
  let score = 0;
  if (move.captured !== null) {
    score += 100 * valueOf(move.captured) - valueOf(move.piece);
  }
  if (move.promotion !== null) {
    score += 100 * EXCHANGE_VALUES[move.promotion];
  }
  return score;
}

function scoreMove(
  state: SearchState,
  position: Position,
  move: Move,
  ply: number,
  tableFromSquare: number,
  tableToSquare: number,
  tablePromotion: PromotionPiece | null,
): number {
  // Whatever the table found last time is the best guess available, and it cost
  // a full search to arrive at.
  if (
    move.from === tableFromSquare &&
    move.to === tableToSquare &&
    move.promotion === tablePromotion
  ) {
    return ORDER_TABLE_MOVE;
  }

  if (move.captured !== null || move.promotion !== null) {
    const exchange = see(position, move);
    return exchange >= 0
      ? ORDER_WINNING_CAPTURE + captureOrder(move)
      : ORDER_LOSING_CAPTURE + exchange;
  }

  const packed = packMove(move);
  if (state.killers[ply * 2] === packed) {
    return ORDER_FIRST_KILLER;
  }
  if (state.killers[ply * 2 + 1] === packed) {
    return ORDER_SECOND_KILLER;
  }

  return state.history[move.from * 64 + move.to]!;
}

/**
 * Swap the best-scoring remaining move into `index`.
 *
 * A selection pass rather than a sort, because most nodes cut off on the first
 * move or two: sorting thirty moves to look at one is work thrown away.
 */
function selectMove(moves: Move[], scores: number[], index: number): void {
  let best = index;
  for (let candidate = index + 1; candidate < moves.length; candidate += 1) {
    if (scores[candidate]! > scores[best]!) {
      best = candidate;
    }
  }

  if (best !== index) {
    const move = moves[index]!;
    moves[index] = moves[best]!;
    moves[best] = move;

    const score = scores[index]!;
    scores[index] = scores[best]!;
    scores[best] = score;
  }
}

/** Captures ordered by what they win, for the quiescence search. */
function orderCaptures(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => captureOrder(b) - captureOrder(a));
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

function outOfBudget(state: SearchState): boolean {
  if (state.nodes >= state.nodeLimit) {
    return true;
  }
  // Reading the clock at every node would cost more than it saves, and a node is
  // bounded work, so a check every few thousand keeps the overshoot invisible.
  return (state.nodes & 2047) === 0 && Date.now() >= state.deadline;
}

/**
 * Has this position already appeared in the line being searched, or in the game
 * that led to it?
 *
 * A search that cannot see a repetition plays into one: it will happily shuffle
 * a won position back and forth, each time believing it is still winning, and it
 * will miss the repetition that saves a lost one. Only every other ply can match,
 * since the side to move is part of the key.
 */
function isRepetition(state: SearchState, key: number, ply: number): boolean {
  for (let back = ply - 2; back >= 0; back -= 2) {
    if (state.path[back] === key) {
      return true;
    }
  }

  for (const earlier of state.before) {
    if (earlier === key) {
      return true;
    }
  }

  return false;
}

/** The same position with the turn handed over: the null move. */
function passTurn(position: Position): Position {
  return {
    ...position,
    turn: opposite(position.turn),
    enPassant: null,
    halfmoveClock: position.halfmoveClock + 1,
  };
}

/**
 * Search on past the main horizon until the position is quiet.
 *
 * This is what stops the engine from believing a static score taken in the
 * middle of an exchange. A fixed-depth search that stops right after RxN counts
 * the knight and never sees PxR, so it walks into losing trades and calls them
 * winning ones; extending only the captures — a cheap, sharply narrowing
 * subtree — makes a leaf score mean "material once the dust settles" rather than
 * "material as of this instant".
 */
function quiescence(
  state: SearchState,
  position: Position,
  alpha: number,
  beta: number,
  ply: number,
  depth: number,
): number {
  state.nodes += 1;

  if (outOfBudget(state)) {
    state.aborted = true;
  }
  if (state.aborted) {
    return 0;
  }

  if (ply >= MAX_PLY) {
    return evaluate(position);
  }

  const inCheck = isInCheck(position, position.turn);

  // A side in check is searched over all its legal replies, the way negamax
  // would. Restricting it to captures would let the search "pass" its way out
  // of a mate it has no actual escape from.
  const moves = inCheck
    ? generateLegalMoves(position)
    : generateLegalCaptures(position);

  if (moves.length === 0) {
    if (inCheck) {
      // Checkmate. Counted from the root so faster mates outrank slower ones,
      // exactly as in negamax.
      return -(MATE_SCORE - ply);
    }

    // Having no captures is not yet evidence of stalemate: the quiet moves were
    // never generated. Worth the one question here, because scoring a dead-drawn
    // position as a rout is the one error this search could make that a deeper
    // search would not correct.
    if (!hasLegalMove(position)) {
      return DRAW_SCORE;
    }
  }

  if (position.halfmoveClock >= 100 || isInsufficientMaterial(position)) {
    return DRAW_SCORE;
  }

  let best: number;

  if (inCheck) {
    // Nothing to stand on: the position has to be resolved by a real move, so
    // the search starts from nothing and tries every reply. With no budget left
    // to do that, the static score is all that remains.
    if (depth === 0) {
      return evaluate(position);
    }
    best = -Infinity;
  } else {
    // Standing pat. Outside of check the side to move is never *obliged* to
    // capture, so declining to is a floor under every capture beneath it — and
    // it is the answer outright once there is no budget left to search them.
    best = evaluate(position);

    if (best >= beta || depth === 0) {
      return best;
    }
    if (best > alpha) {
      alpha = best;
    }
  }

  for (const move of orderCaptures(moves)) {
    if (!inCheck) {
      // Delta pruning: when the standing score plus the entire captured piece
      // plus the margin still falls short of alpha, nothing under this capture
      // can matter. Skipped in check, where `best` is not a stand-pat score and
      // the reply is forced rather than optional, and on promotions, which swing
      // by more than the piece they take.
      if (
        move.promotion === null &&
        move.captured !== null &&
        best + valueOf(move.captured) + DELTA_MARGIN <= alpha
      ) {
        continue;
      }

      // And a capture that loses material outright is not worth a node. The
      // exchange is decided statically rather than by searching it, which is the
      // whole saving: a queen taking a defended pawn is refuted for free.
      if (see(position, move) < 0) {
        continue;
      }
    }

    const score = -quiescence(
      state,
      applyMove(position, move),
      -beta,
      -alpha,
      ply + 1,
      depth - 1,
    );

    if (state.aborted) {
      return 0;
    }

    if (score > best) {
      best = score;
    }
    if (score > alpha) {
      alpha = score;
    }
    if (alpha >= beta) {
      break;
    }
  }

  return best;
}

function negamax(
  state: SearchState,
  position: Position,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
  canPass: boolean,
  extensions: number,
): number {
  state.nodes += 1;

  if (outOfBudget(state)) {
    state.aborted = true;
  }
  if (state.aborted) {
    return 0;
  }

  if (ply >= MAX_PLY) {
    return evaluate(position);
  }

  const key = hashPosition(position);
  state.path[ply] = key;

  // Draws that need no move list. A repeated position cannot also be checkmate —
  // the first occurrence would have ended the line — and neither can a position
  // with too little material to mate with, so both are safe to answer here.
  // The fifty-move rule is not: it can fall on the very move that mates, so it
  // waits until the move list proves there is a legal reply.
  if (isRepetition(state, key, ply) || isInsufficientMaterial(position)) {
    return DRAW_SCORE;
  }

  // Mate distance pruning. Nothing from here can mate sooner than the next move,
  // and nothing can be mated slower than this instant, so a window outside those
  // bounds is asking for something that does not exist.
  const soonestMate = MATE_SCORE - ply - 1;
  const latestLoss = -(MATE_SCORE - ply);
  if (alpha < latestLoss) {
    alpha = latestLoss;
  }
  if (beta > soonestMate) {
    beta = soonestMate;
  }
  if (alpha >= beta) {
    return alpha;
  }

  const found = probe(key, ply);
  // Copied out before anything recursive runs, which would overwrite `probed`.
  const tableFromSquare = found ? probed.from : -1;
  const tableToSquare = found ? probed.to : -1;
  const tablePromotion = found ? probed.promotion : null;

  if (found && probed.depth >= depth) {
    const score = probed.score;
    if (
      probed.flag === EXACT ||
      (probed.flag === LOWER_BOUND && score >= beta) ||
      (probed.flag === UPPER_BOUND && score <= alpha)
    ) {
      return score;
    }
  }

  const inCheck = isInCheck(position, position.turn);

  // A forced sequence is worth following past the horizon: a search that stops
  // counting while the king is in check scores a position whose reply is not
  // optional, and the tactic that follows lands one ply out of view.
  if (inCheck && depth >= 1 && extensions < MAX_EXTENSIONS) {
    depth += 1;
    extensions += 1;
  }

  if (depth <= 0) {
    return quiescence(state, position, alpha, beta, ply, MAX_QUIESCENCE_PLY);
  }

  // Null move pruning. If handing the opponent a free move still leaves the
  // position better than beta, the real move would only be better, and the whole
  // subtree can go unsearched. It assumes having to move is never a
  // disadvantage — false in zugzwang, which is why a side down to pawns is
  // excluded, along with a side in check, which cannot pass at all.
  if (
    canPass &&
    !inCheck &&
    depth >= 3 &&
    beta < MATE_THRESHOLD &&
    hasNonPawnMaterial(position, position.turn)
  ) {
    const reduction = depth >= 6 ? 3 : 2;
    const score = -negamax(
      state,
      passTurn(position),
      depth - 1 - reduction,
      -beta,
      -beta + 1,
      ply + 1,
      false,
      extensions,
    );

    if (state.aborted) {
      return 0;
    }

    if (score >= beta) {
      // A mate "proved" by letting the opponent move twice proves nothing. The
      // cutoff still stands; the mate claim does not travel with it.
      return score >= MATE_THRESHOLD ? beta : score;
    }
  }

  const moves = generateLegalMoves(position);

  if (moves.length === 0) {
    // Prefer faster mates (and slower losses) by counting plies from the root.
    return inCheck ? -(MATE_SCORE - ply) : DRAW_SCORE;
  }

  if (position.halfmoveClock >= 100) {
    return DRAW_SCORE;
  }

  const scores = moves.map((move) =>
    scoreMove(
      state,
      position,
      move,
      ply,
      tableFromSquare,
      tableToSquare,
      tablePromotion,
    ),
  );

  const openingAlpha = alpha;
  let best = -Infinity;
  let bestFrom = -1;
  let bestTo = -1;
  let bestPromotion: PromotionPiece | null = null;

  for (let index = 0; index < moves.length; index += 1) {
    selectMove(moves, scores, index);
    const move = moves[index]!;
    const quiet = move.captured === null && move.promotion === null;

    // Late move reduction. Ordering has already put the moves worth looking at
    // first, so a quiet move this far down the list is most likely irrelevant:
    // look at it shallowly, and pay for the full depth only if it turns out to
    // beat alpha anyway. A move that gives check has its ply handed straight
    // back by the check extension one level down.
    let reduction = 0;
    if (depth >= 3 && index >= 3 && quiet && !inCheck) {
      reduction = index >= 6 ? 2 : 1;
      if (reduction > depth - 2) {
        reduction = depth - 2;
      }
    }

    const child = applyMove(position, move);
    let score: number;

    if (index === 0) {
      score = -negamax(
        state,
        child,
        depth - 1,
        -beta,
        -alpha,
        ply + 1,
        true,
        extensions,
      );
    } else {
      // Everything after the first move is asked a narrower question: is it
      // better than what we already have? A null window answers that far
      // cheaper, and only a move that says yes is searched properly.
      score = -negamax(
        state,
        child,
        depth - 1 - reduction,
        -alpha - 1,
        -alpha,
        ply + 1,
        true,
        extensions,
      );

      if (!state.aborted && score > alpha && (reduction > 0 || score < beta)) {
        score = -negamax(
          state,
          child,
          depth - 1,
          -beta,
          -alpha,
          ply + 1,
          true,
          extensions,
        );
      }
    }

    if (state.aborted) {
      return 0;
    }

    if (score > best) {
      best = score;
      bestFrom = move.from;
      bestTo = move.to;
      bestPromotion = move.promotion;
    }

    if (score > alpha) {
      alpha = score;
    }

    if (alpha >= beta) {
      // This move refuted the position. Quiet moves that do that are worth
      // trying early elsewhere: at the same ply of a sibling line, where the
      // same threat usually still stands, and anywhere at all in proportion to
      // how often it has worked.
      if (quiet) {
        rememberKiller(state, ply, move);
        rememberHistory(state, move, depth);
      }
      break;
    }
  }

  store(
    key,
    depth,
    ply,
    best,
    best >= beta ? LOWER_BOUND : best > openingAlpha ? EXACT : UPPER_BOUND,
    bestFrom,
    bestTo,
    bestPromotion,
  );

  return best;
}

/**
 * The line the search expects, read back out of the transposition table.
 *
 * Every move is checked against the legal move list before it is trusted: a
 * table slot can hold an entry for a different position that happened to collide
 * with this one, and an illegal move would otherwise end up in the line.
 */
function principalVariation(position: Position, first: Move): Move[] {
  const line: Move[] = [first];
  const seen = new Set<number>();
  let current = applyMove(position, first);

  while (line.length < MAX_PLY) {
    const key = hashPosition(current);
    if (seen.has(key) || !probe(key, 0) || probed.from < 0) {
      break;
    }
    seen.add(key);

    const move = findMove(
      generateLegalMoves(current),
      probed.from,
      probed.to,
      probed.promotion ?? undefined,
    );

    if (!move) {
      break;
    }

    line.push(move);
    current = applyMove(current, move);
  }

  return line;
}

function shuffle(moves: Move[]): void {
  for (let index = moves.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const move = moves[index]!;
    moves[index] = moves[swap]!;
    moves[swap] = move;
  }
}

/** Reorder root moves best-first, carrying their scores with them. */
function reorderByScore(moves: Move[], scores: number[]): void {
  const order = moves.map((move, index) => ({ move, score: scores[index]! }));
  order.sort((a, b) => b.score - a.score);

  for (let index = 0; index < order.length; index += 1) {
    moves[index] = order[index]!.move;
    scores[index] = order[index]!.score;
  }
}

/**
 * Search `position` within `limits` and report the best move found.
 *
 * `history` is the positions the game passed through on its way here, most
 * recent last, so the search can recognise a repetition that predates the root.
 * Only the moves since the last capture or pawn push can matter, and only those
 * are read.
 *
 * The search deepens by one ply at a time rather than going straight for the
 * target depth, which sounds wasteful and is the opposite: each pass leaves the
 * transposition table full of best moves for the next one to try first, and a
 * well-ordered search of depth n costs a fraction of a badly ordered one. It also
 * means there is always a complete answer to hand, which is what makes searching
 * against a clock possible at all.
 */
export function search(
  position: Position,
  limits: SearchLimits = {},
  history: readonly Position[] = [],
): SearchResult {
  generation = nextGeneration();

  const reversible = Math.min(position.halfmoveClock, history.length);
  const before: number[] = [];
  for (let index = history.length - reversible; index < history.length; index += 1) {
    before.push(hashPosition(history[index]!));
  }

  const unbounded =
    limits.nodes === undefined &&
    limits.depth === undefined &&
    limits.timeMs === undefined;

  const state: SearchState = {
    nodes: 0,
    nodeLimit: limits.nodes ?? (unbounded ? DEFAULT_NODES : Infinity),
    deadline:
      limits.timeMs === undefined ? Infinity : Date.now() + limits.timeMs,
    aborted: false,
    path: new Float64Array(MAX_PLY + 1),
    before,
    killers: new Int32Array(MAX_PLY * 2).fill(-1),
    history: new Int32Array(64 * 64),
  };

  const moves = generateLegalMoves(position);
  if (moves.length === 0) {
    return { bestMove: null, score: 0, depth: 0, nodes: 0, pv: [] };
  }

  if (limits.randomize === true) {
    // Ties are broken by whichever equal move the ordering happens to reach
    // first, so shuffling before the first pass is what keeps the engine from
    // playing an identical game every time.
    shuffle(moves);
  }

  state.path[0] = hashPosition(position);

  const maxDepth = Math.min(limits.depth ?? MAX_PLY - 1, MAX_PLY - 1);
  const scores: number[] = moves.map(() => -Infinity);

  let bestMove = moves[0]!;
  let bestScore = 0;
  let reachedDepth = 0;

  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let alpha = -Infinity;
    let iterationBest: Move | null = null;
    let iterationScore = -Infinity;

    for (let index = 0; index < moves.length; index += 1) {
      const move = moves[index]!;
      const child = applyMove(position, move);

      let score: number;
      if (index === 0) {
        score = -negamax(state, child, depth - 1, -Infinity, -alpha, 1, true, 0);
      } else {
        score = -negamax(state, child, depth - 1, -alpha - 1, -alpha, 1, true, 0);
        if (!state.aborted && score > alpha) {
          // It beat the best so far, so the cheap answer was not enough: the
          // real score decides whether it takes the place.
          score = -negamax(state, child, depth - 1, -Infinity, -alpha, 1, true, 0);
        }
      }

      if (state.aborted) {
        break;
      }

      scores[index] = score;

      if (score > iterationScore) {
        iterationScore = score;
        iterationBest = move;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    // A part-finished pass is still worth keeping. Root moves are searched in
    // the previous pass's order, so the ones it got through are the candidates,
    // and a deeper verdict on those beats a shallower verdict on all of them.
    if (iterationBest !== null) {
      bestMove = iterationBest;
      bestScore = iterationScore;
      reachedDepth = depth;
    }

    if (state.aborted) {
      break;
    }

    // Nothing left to learn: a forced mate is as good as the search gets, and a
    // position with one legal move does not need an opinion.
    if (Math.abs(bestScore) >= MATE_THRESHOLD || moves.length === 1) {
      break;
    }

    reorderByScore(moves, scores);
  }

  return {
    bestMove,
    score: bestScore,
    depth: reachedDepth,
    nodes: state.nodes,
    pv: principalVariation(position, bestMove),
  };
}
