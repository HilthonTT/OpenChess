import { opposite } from "../board";
import type { EvalWeights } from "../evaluate";
import type { Color, Position } from "../types";

import { DRAW_SCORE } from "./constants";

export type SearchState = {
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
  /** What this search values; see `EvalWeights`. */
  weights: EvalWeights;
  /** The side the search is being run for — whose draw `contempt` is aimed at. */
  rootTurn: Color;
  /** Centipawns a draw is worth less than nothing to `rootTurn`. */
  contempt: number;
};

/**
 * What a draw is worth here. Dead level unless the engine has been told to
 * dislike them, in which case it is worth less to the side the search is for
 * and correspondingly more to the other — the same number, read from two ends.
 */
export function drawScore(state: SearchState, position: Position): number {
  if (state.contempt === 0) {
    return DRAW_SCORE;
  }
  return position.turn === state.rootTurn ? -state.contempt : state.contempt;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

export function outOfBudget(state: SearchState): boolean {
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
export function isRepetition(
  state: SearchState,
  key: number,
  ply: number,
): boolean {
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
export function passTurn(position: Position): Position {
  return {
    ...position,
    turn: opposite(position.turn),
    enPassant: null,
    halfmoveClock: position.halfmoveClock + 1,
  };
}
