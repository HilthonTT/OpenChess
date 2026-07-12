import { STARTING_FEN, fromAlgebraic, toAlgebraic, toFen } from "./board";
import { createGame, findLegalMove, play, type Game } from "./game";
import { toSan } from "./san";
import type { Move, PromotionPiece } from "./types";

export type GameRecord = {
  fen?: string;
  moves: string[];
};

const PROMOTIONS: readonly string[] = ["q", "r", "b", "n"];

function isPromotionPiece(value: string): value is PromotionPiece {
  return PROMOTIONS.includes(value);
}

/** "e2e4", or "e7e8q" for a promotion. Castling is written as the king's move. */
export function toUci(move: Move): string {
  const promotion = move.promotion ?? "";
  return `${toAlgebraic(move.from)}${toAlgebraic(move.to)}${promotion}`;
}

/**
 * The legal move `uci` names in `game`. Returns null when the string is
 * malformed or names no legal move — including a move onto the last rank that
 * omits the promotion piece, which would otherwise silently become a queen.
 */
export function findUciMove(game: Game, uci: string): Move | null {
  if (uci.length !== 4 && uci.length !== 5) {
    return null;
  }

  const from = fromAlgebraic(uci.slice(0, 2));
  const to = fromAlgebraic(uci.slice(2, 4));
  if (from === null || to === null) {
    return null;
  }

  const suffix = uci.slice(4);
  if (suffix.length > 0 && !isPromotionPiece(suffix)) {
    return null;
  }

  const promotion = suffix.length > 0 ? (suffix as PromotionPiece) : undefined;
  const move = findLegalMove(game, from, to, promotion);
  if (!move) {
    return null;
  }

  // Ambiguous: the caller must say which piece to promote to.
  if (promotion === undefined && move.promotion !== null) {
    return null;
  }

  return move;
}

/** The legal move `san` names in `game`, matched against the legal moves' own SAN. */
export function findSanMove(game: Game, san: string): Move | null {
  // Check and mate suffixes are decoration; "0-0" is a common mis-spelling of
  // castling, and the "!?" annotations are not part of the move.
  const wanted = san
    .replace(/[+#?!]+$/, "")
    .replace(/0/g, "O")
    .trim();

  const match = game.legalMoves.find(
    (move) =>
      toSan(game.position, move, game.legalMoves).replace(/[+#]$/, "") ===
      wanted,
  );

  return match ?? null;
}

/** Play the move named by `uci`. Throws if it names no legal move. */
export function playUci(game: Game, uci: string): Game {
  const move = findUciMove(game, uci);
  if (!move) {
    throw new Error(
      `Illegal or malformed move "${uci}" in ${toFen(game.position)}`,
    );
  }
  return play(game, move);
}

/** Play the move named by `san`. Throws if it names no legal move. */
export function playSan(game: Game, san: string): Game {
  const move = findSanMove(game, san);
  if (!move) {
    throw new Error(
      `Illegal or malformed move "${san}" in ${toFen(game.position)}`,
    );
  }
  return play(game, move);
}

/** The moves played so far, as UCI strings. */
export function gameMoves(game: Game): string[] {
  return game.history.map((entry) => toUci(entry.move));
}

/**
 * The position the game began from — the one before the first move, not the
 * current one, since replaying recomputes the clocks and move numbers.
 */
export function startingFen(game: Game): string {
  const first = game.history[0];
  return toFen(first ? first.before : game.position);
}

/** Everything needed to reconstruct `game`. `fen` is omitted for a normal game. */
export function toRecord(game: Game): GameRecord {
  const fen = startingFen(game);
  const moves = gameMoves(game);
  return fen === STARTING_FEN ? { moves } : { fen, moves };
}

/**
 * Rebuild a game from a record by replaying the moves, so the repetition map,
 * the history, and the status are all correct. Throws on the first move that
 * isn't legal, naming its index.
 */
export function fromRecord(record: GameRecord): Game {
  let game = createGame(record.fen ?? STARTING_FEN);

  for (const [index, uci] of record.moves.entries()) {
    const move = findUciMove(game, uci);
    if (!move) {
      throw new Error(
        `Illegal or malformed move "${uci}" at index ${index} of ${record.moves.length}`,
      );
    }
    game = play(game, move);
  }

  return game;
}
