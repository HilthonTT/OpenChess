import { evaluate, hasNonPawnMaterial } from "../evaluate";
import {
  applyMove,
  findMove,
  generateLegalCaptures,
  generateLegalMoves,
  hasLegalMove,
  isInCheck,
  isInsufficientMaterial,
} from "../moves";
import { hashPosition } from "../zobrist";
import type { Move, Position, PromotionPiece } from "../types";

import {
  DELTA_MARGIN,
  MATE_SCORE,
  MATE_THRESHOLD,
  MAX_EXTENSIONS,
  MAX_PLY,
  MAX_QUIESCENCE_PLY,
} from "./constants";
import { exchangeValueOf, see } from "./exchange";
import {
  orderCaptures,
  rememberHistory,
  rememberKiller,
  scoreMove,
  selectMove,
} from "./ordering";
import {
  type SearchState,
  drawScore,
  isRepetition,
  outOfBudget,
  passTurn,
} from "./state";
import {
  EXACT,
  LOWER_BOUND,
  UPPER_BOUND,
  probe,
  probed,
  store,
} from "./transposition";

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
    return evaluate(position, state.weights);
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
      return drawScore(state, position);
    }
  }

  if (position.halfmoveClock >= 100 || isInsufficientMaterial(position)) {
    return drawScore(state, position);
  }

  let best: number;

  if (inCheck) {
    // Nothing to stand on: the position has to be resolved by a real move, so
    // the search starts from nothing and tries every reply. With no budget left
    // to do that, the static score is all that remains.
    if (depth === 0) {
      return evaluate(position, state.weights);
    }
    best = -Infinity;
  } else {
    // Standing pat. Outside of check the side to move is never *obliged* to
    // capture, so declining to is a floor under every capture beneath it — and
    // it is the answer outright once there is no budget left to search them.
    best = evaluate(position, state.weights);

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
        best + exchangeValueOf(move.captured) + DELTA_MARGIN <= alpha
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

export function negamax(
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
    return evaluate(position, state.weights);
  }

  const key = hashPosition(position);
  state.path[ply] = key;

  // Draws that need no move list. A repeated position cannot also be checkmate —
  // the first occurrence would have ended the line — and neither can a position
  // with too little material to mate with, so both are safe to answer here.
  // The fifty-move rule is not: it can fall on the very move that mates, so it
  // waits until the move list proves there is a legal reply.
  if (isRepetition(state, key, ply) || isInsufficientMaterial(position)) {
    return drawScore(state, position);
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
    return inCheck ? -(MATE_SCORE - ply) : drawScore(state, position);
  }

  if (position.halfmoveClock >= 100) {
    return drawScore(state, position);
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
export function principalVariation(position: Position, first: Move): Move[] {
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
