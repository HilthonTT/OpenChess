import {
  STARTING_FEN,
  fromAlgebraic,
  pieceAt,
  toAlgebraic,
  toFen,
} from "./board";
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

export function toUci(move: Move): string {
  const promotion = move.promotion ?? "";
  return `${toAlgebraic(move.from)}${toAlgebraic(move.to)}${promotion}`;
}

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

  if (promotion === undefined && move.promotion !== null) {
    return null;
  }

  return move;
}

export function findSanMove(game: Game, san: string): Move | null {
  const wanted = san
    .replace(/[+#?!]+$/, "")
    .replace(/0/g, "O")
    .trim();

  const match = game.legalMoves.find(
    (move) =>
      toSan(game.position, move, game.legalMoves).replace(/[+#]$/, "") ===
      wanted,
  );

  return match ?? findSanMoveLoosely(game, wanted);
}

const LOOSE_SAN = /^([KQRBN])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([QRBN]))?$/;

function findSanMoveLoosely(game: Game, wanted: string): Move | null {
  const parsed = LOOSE_SAN.exec(wanted);
  if (!parsed) {
    return null;
  }

  const [, piece, fromFile, fromRank, to, promotion] = parsed;
  const target = fromAlgebraic(to!);
  const wantedPiece = (piece ?? "P").toLowerCase();
  const wantedPromotion = promotion?.toLowerCase() ?? null;

  const candidates = game.legalMoves.filter((move) => {
    if (move.to !== target || move.isCastle !== null) {
      return false;
    }
    if (pieceAt(game.position.board, move.from).toLowerCase() !== wantedPiece) {
      return false;
    }
    if ((move.promotion ?? null) !== wantedPromotion) {
      return false;
    }
    const from = toAlgebraic(move.from);
    if (fromFile && from[0] !== fromFile) {
      return false;
    }
    if (fromRank && from[1] !== fromRank) {
      return false;
    }
    return true;
  });

  return candidates.length === 1 ? candidates[0]! : null;
}

export function playUci(game: Game, uci: string): Game {
  const move = findUciMove(game, uci);
  if (!move) {
    throw new Error(
      `Illegal or malformed move "${uci}" in ${toFen(game.position)}`,
    );
  }
  return play(game, move);
}

export function playSan(game: Game, san: string): Game {
  const move = findSanMove(game, san);
  if (!move) {
    throw new Error(
      `Illegal or malformed move "${san}" in ${toFen(game.position)}`,
    );
  }
  return play(game, move);
}

export function gameMoves(game: Game): string[] {
  return game.history.map((entry) => toUci(entry.move));
}

export function startingFen(game: Game): string {
  const first = game.history[0];
  return toFen(first ? first.before : game.position);
}

export function toRecord(game: Game): GameRecord {
  const fen = startingFen(game);
  const moves = gameMoves(game);
  return fen === STARTING_FEN ? { moves } : { fen, moves };
}

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
