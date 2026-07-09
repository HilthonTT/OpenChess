import { FILES, fileOf, rankOf, toAlgebraic } from "./board";
import { applyMove, generateLegalMoves, isInCheck } from "./moves";
import type { Move, Position } from "./types";

/**
 * Standard Algebraic Notation for `move`, played from `position`.
 *
 * `legalMoves` is the legal move list for `position`; pass it in when you
 * already have it, since disambiguation needs to know which other pieces of the
 * same kind could also reach the destination square.
 */
export function toSan(
  position: Position,
  move: Move,
  legalMoves: Move[] = generateLegalMoves(position),
): string {
  const next = applyMove(position, move);
  const opponentInCheck = isInCheck(next, next.turn);
  const opponentHasMoves = generateLegalMoves(next).length > 0;
  const suffix = opponentInCheck ? (opponentHasMoves ? "+" : "#") : "";

  if (move.isCastle) {
    return `${move.isCastle === "king" ? "O-O" : "O-O-O"}${suffix}`;
  }

  const type = move.piece.toLowerCase();
  const target = toAlgebraic(move.to);
  const capture = move.captured !== null;

  if (type === "p") {
    const origin = capture ? `${FILES[fileOf(move.from)]}x` : "";
    const promotion = move.promotion
      ? `=${move.promotion.toUpperCase()}`
      : "";
    return `${origin}${target}${promotion}${suffix}`;
  }

  return `${move.piece.toUpperCase()}${disambiguate(move, legalMoves)}${
    capture ? "x" : ""
  }${target}${suffix}`;
}

/**
 * The shortest origin hint that separates `move` from the other legal moves of
 * the same piece kind onto the same square: file if that suffices, else rank,
 * else both (needed only with three or more same-kind pieces).
 */
function disambiguate(move: Move, legalMoves: Move[]): string {
  const rivals = legalMoves.filter(
    (other) =>
      other.to === move.to &&
      other.piece === move.piece &&
      other.from !== move.from,
  );

  if (rivals.length === 0) {
    return "";
  }

  const file = FILES[fileOf(move.from)] as string;
  const rank = String(rankOf(move.from) + 1);

  if (!rivals.some((other) => fileOf(other.from) === fileOf(move.from))) {
    return file;
  }

  if (!rivals.some((other) => rankOf(other.from) === rankOf(move.from))) {
    return rank;
  }

  return `${file}${rank}`;
}
