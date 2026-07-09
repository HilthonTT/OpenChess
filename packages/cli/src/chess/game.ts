import { STARTING_FEN, parseFen, repetitionKey, toFen } from "./board";
import {
  applyMove,
  findMove,
  generateLegalMoves,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { toSan } from "./san";
import type { GameStatus, Move, Position, PromotionPiece } from "./types";

export type HistoryEntry = {
  move: Move;
  san: string;
  /** The position *before* the move, so undo is a pop rather than a replay. */
  before: Position;
};

/**
 * An immutable game: every `play` returns a new `Game`, which keeps React state
 * updates trivial and makes undo a matter of keeping the old value around.
 */
export type Game = {
  position: Position;
  legalMoves: Move[];
  status: GameStatus;
  history: HistoryEntry[];
  /** How many times each position has occurred, for threefold repetition. */
  repetitions: ReadonlyMap<string, number>;
};

export function isGameOver(status: GameStatus): boolean {
  return status !== "playing" && status !== "check";
}

export function isDraw(status: GameStatus): boolean {
  return status.startsWith("draw-") || status === "stalemate";
}

function statusOf(
  position: Position,
  legalMoves: Move[],
  repetitions: ReadonlyMap<string, number>,
): GameStatus {
  const inCheck = isInCheck(position, position.turn);

  if (legalMoves.length === 0) {
    return inCheck ? "checkmate" : "stalemate";
  }

  // Terminal draws outrank a mere check: the game is over either way.
  if (isInsufficientMaterial(position)) {
    return "draw-insufficient-material";
  }

  if ((repetitions.get(repetitionKey(position)) ?? 0) >= 3) {
    return "draw-repetition";
  }

  if (position.halfmoveClock >= 100) {
    return "draw-fifty-move";
  }

  return inCheck ? "check" : "playing";
}

function build(
  position: Position,
  history: HistoryEntry[],
  repetitions: ReadonlyMap<string, number>,
): Game {
  const legalMoves = generateLegalMoves(position);

  return {
    position,
    legalMoves,
    status: statusOf(position, legalMoves, repetitions),
    history,
    repetitions,
  };
}

export function createGame(fen: string = STARTING_FEN): Game {
  const position = parseFen(fen);
  const repetitions = new Map([[repetitionKey(position), 1]]);
  return build(position, [], repetitions);
}

/** The legal moves starting from `square`, for highlighting the board. */
export function movesFromSquare(game: Game, square: number): Move[] {
  return game.legalMoves.filter((move) => move.from === square);
}

/**
 * Look up the legal move from `from` to `to`. When the move is a promotion and
 * no `promotion` piece is given this returns the first match, so callers that
 * need the player to choose should check `needsPromotion` first.
 */
export function findLegalMove(
  game: Game,
  from: number,
  to: number,
  promotion?: PromotionPiece,
): Move | undefined {
  return findMove(game.legalMoves, from, to, promotion);
}

/** True when moving from `from` to `to` requires picking a promotion piece. */
export function needsPromotion(game: Game, from: number, to: number): boolean {
  return game.legalMoves.some(
    (move) => move.from === from && move.to === to && move.promotion !== null,
  );
}

/** Play a legal move, returning the new game. Throws if the move isn't legal. */
export function play(game: Game, move: Move): Game {
  if (isGameOver(game.status)) {
    throw new Error(`Cannot move: the game is over (${game.status})`);
  }

  const legal = findMove(
    game.legalMoves,
    move.from,
    move.to,
    move.promotion ?? undefined,
  );

  if (!legal) {
    throw new Error(
      `Illegal move ${toFen(game.position)}: ${move.from} -> ${move.to}`,
    );
  }

  const san = toSan(game.position, legal, game.legalMoves);
  const next = applyMove(game.position, legal);

  const key = repetitionKey(next);
  const repetitions = new Map(game.repetitions);
  repetitions.set(key, (repetitions.get(key) ?? 0) + 1);

  const history: HistoryEntry[] = [
    ...game.history,
    { move: legal, san, before: game.position },
  ];

  return build(next, history, repetitions);
}

/** Take back the last move. Returns the game unchanged at the start position. */
export function undo(game: Game): Game {
  const last = game.history[game.history.length - 1];
  if (!last) {
    return game;
  }

  const key = repetitionKey(game.position);
  const repetitions = new Map(game.repetitions);
  const count = (repetitions.get(key) ?? 1) - 1;
  if (count > 0) {
    repetitions.set(key, count);
  } else {
    repetitions.delete(key);
  }

  return build(last.before, game.history.slice(0, -1), repetitions);
}

/** Moves grouped into numbered pairs, ready to print as a move list. */
export function movePairs(
  game: Game,
): Array<{ number: number; white: string; black: string | null }> {
  const pairs: Array<{ number: number; white: string; black: string | null }> =
    [];

  const first = game.history[0];
  // A game loaded from a FEN can begin with black to move.
  const startsWithBlack = first?.before.turn === "b";
  let index = 0;
  let number = first?.before.fullmoveNumber ?? 1;

  if (startsWithBlack && first) {
    pairs.push({ number, white: "…", black: first.san });
    index = 1;
    number += 1;
  }

  for (; index < game.history.length; index += 2) {
    const white = game.history[index];
    const black = game.history[index + 1];
    if (!white) {
      break;
    }

    pairs.push({ number, white: white.san, black: black?.san ?? null });
    number += 1;
  }

  return pairs;
}
