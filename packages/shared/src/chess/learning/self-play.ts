import { STARTING_FEN } from "../board";
import { type EvalWeights, evaluationFeatures } from "../evaluate";
import { createGame, findLegalMove, isGameOver, play } from "../game";
import { applyMove, findMove, generateLegalMoves, isInCheck } from "../moves";
import { chooseBookMove } from "../opening-book";
import { MATE_THRESHOLD, search } from "../search";
import type { Color, GameStatus, Move, Position } from "../types";
import type { Leaf, Outcome } from "./td-leaf";

export type TrainingPlayer = {
  weights: EvalWeights;
  contempt?: number;
};

export type TrainingLimits = {
  depth: number;
  nodes?: number;
};

export type TrainingGameOptions = {
  learner: TrainingPlayer;
  opponent: TrainingPlayer;
  learnerColor: Color;
  limits: TrainingLimits;
  bookPlies?: number;
  maxPlies?: number;
  fen?: string;
  record?: boolean;
  random?: () => number;
};

export type TrainingGame = {
  learnerColor: Color;
  outcome: Outcome;
  status: GameStatus | "adjudicated";
  plies: number;
  leaves: Leaf[];
};

export const DEFAULT_BOOK_PLIES = 8;
export const DEFAULT_MAX_PLIES = 300;

function principalLeaf(position: Position, line: readonly Move[]): Position {
  let current = position;
  for (const move of line) {
    const legal = findMove(
      generateLegalMoves(current),
      move.from,
      move.to,
      move.promotion ?? undefined,
    );
    if (!legal) {
      break;
    }
    current = applyMove(current, legal);
  }
  return current;
}

function leafFor(
  position: Position,
  line: readonly Move[],
  score: number,
): Leaf {
  if (Math.abs(score) >= MATE_THRESHOLD) {
    return { kind: "fixed", value: score > 0 ? 1 : -1 };
  }

  const leaf = principalLeaf(position, line);
  if (generateLegalMoves(leaf).length === 0) {
    if (!isInCheck(leaf, leaf.turn)) {
      return { kind: "fixed", value: 0 };
    }
    return { kind: "fixed", value: leaf.turn === position.turn ? -1 : 1 };
  }

  return { kind: "features", features: evaluationFeatures(leaf) };
}

export function playTrainingGame(options: TrainingGameOptions): TrainingGame {
  const random = options.random ?? Math.random;
  const bookPlies = options.bookPlies ?? DEFAULT_BOOK_PLIES;
  const maxPlies = options.maxPlies ?? DEFAULT_MAX_PLIES;
  const record = options.record ?? true;

  let game = createGame(options.fen ?? STARTING_FEN);
  const leaves: Leaf[] = [];

  while (!isGameOver(game.status) && game.history.length < maxPlies) {
    const position = game.position;

    if (game.history.length < bookPlies && options.fen === undefined) {
      const book = chooseBookMove(position, { random });
      const move =
        book &&
        findLegalMove(game, book.from, book.to, book.promotion ?? undefined);
      if (move) {
        game = play(game, move);
        continue;
      }
    }

    const learnerToMove = position.turn === options.learnerColor;
    const mover = learnerToMove ? options.learner : options.opponent;

    const result = search(
      position,
      {
        depth: options.limits.depth,
        nodes: options.limits.nodes,
        weights: mover.weights,
        contempt: mover.contempt ?? 0,
        randomize: true,
      },
      game.history.map((entry) => entry.before),
    );

    if (!result.bestMove) {
      break;
    }

    if (learnerToMove && record) {
      leaves.push(leafFor(position, result.pv, result.score));
    }

    game = play(game, result.bestMove);
  }

  return {
    learnerColor: options.learnerColor,
    outcome: outcomeFor(game.status, game.position.turn, options.learnerColor),
    status: isGameOver(game.status) ? game.status : "adjudicated",
    plies: game.history.length,
    leaves,
  };
}

function outcomeFor(
  status: GameStatus,
  toMove: Color,
  learner: Color,
): Outcome {
  if (status !== "checkmate") {
    return 0;
  }
  return toMove === learner ? -1 : 1;
}
