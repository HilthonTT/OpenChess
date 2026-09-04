import { opposite } from "../board";
import type { EvalWeights } from "../evaluate";
import type { Color, Position } from "../types";

import { DRAW_SCORE } from "./constants";

export type SearchState = {
  nodes: number;
  nodeLimit: number;
  deadline: number;
  aborted: boolean;
  path: Float64Array;
  before: readonly number[];
  killers: Int32Array;
  history: Int32Array;
  weights: EvalWeights;
  rootTurn: Color;
  contempt: number;
};

export function drawScore(state: SearchState, position: Position): number {
  if (state.contempt === 0) {
    return DRAW_SCORE;
  }
  return position.turn === state.rootTurn ? -state.contempt : state.contempt;
}

export function outOfBudget(state: SearchState): boolean {
  if (state.nodes >= state.nodeLimit) {
    return true;
  }
  return (state.nodes & 2047) === 0 && Date.now() >= state.deadline;
}

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

export function passTurn(position: Position): Position {
  return {
    ...position,
    turn: opposite(position.turn),
    enPassant: null,
    halfmoveClock: position.halfmoveClock + 1,
  };
}
