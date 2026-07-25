import { enPassantIsCapturable, fileOf, isPiece } from "./board";
import type { Piece, Position } from "./types";

/**
 * Zobrist hashing: one number that stands in for a whole position.
 *
 * The search reaches the same position by many different move orders, and a
 * transposition table only pays for itself if recognising a position is far
 * cheaper than searching it again. Comparing positions field by field, or keying
 * on `repetitionKey`'s FEN string, would cost more than it saves — a key that is
 * one XOR per piece, and a plain number at that, is what makes the table and the
 * in-search repetition check affordable.
 *
 * The keys agree with `repetitionKey` on what counts as the same position: an
 * en passant square that no pawn can actually capture on is not part of the key,
 * so a threefold that FIDE would recognise is one the search recognises too.
 */

/** Where each piece's 64 keys begin. */
const PIECE_INDEX: Record<Piece, number> = {
  P: 0,
  N: 1,
  B: 2,
  R: 3,
  Q: 4,
  K: 5,
  p: 6,
  n: 7,
  b: 8,
  r: 9,
  q: 10,
  k: 11,
};

const TURN_WORD = 12 * 64;
const CASTLING_WORD = TURN_WORD + 1;
const EN_PASSANT_WORD = CASTLING_WORD + 4;
const WORD_COUNT = EN_PASSANT_WORD + 8;

/**
 * Keys are built as two 32-bit halves and packed into one number at the end: the
 * low 21 bits of the high word scaled above all 32 bits of the low word. That is
 * 53 bits — exactly what a double holds as an exact integer — which keeps a key
 * usable as a numeric array index and needs no BigInt.
 *
 * 53 bits is short of a real 64-bit key, so two different positions can collide.
 * At the table sizes here the odds are a few in a hundred thousand across an
 * entire search, and the search guards the consequences anyway: a transposition
 * table move is checked against the legal move list before it is played.
 */
const HIGH_MASK = 0x1fffff;
const LOW_SCALE = 4294967296;

/**
 * xorshift32 from a fixed seed. The keys only have to be well spread, not
 * unguessable, and generating them deterministically rather than from
 * `Math.random` is what lets the same search of the same position return the
 * same answer twice — which the analysis screen depends on to report a stable
 * accuracy for a game.
 */
function keyTables(): { high: Int32Array; low: Int32Array } {
  let state = 0x1a2b3c4d;

  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state;
  };

  const high = new Int32Array(WORD_COUNT);
  const low = new Int32Array(WORD_COUNT);

  for (let word = 0; word < WORD_COUNT; word += 1) {
    high[word] = next();
    low[word] = next();
  }

  return { high, low };
}

const { high: HIGH, low: LOW } = keyTables();

/** The key for `position`, as a 53-bit integer. */
export function hashPosition(position: Position): number {
  let high = 0;
  let low = 0;

  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (piece === undefined || !isPiece(piece)) {
      continue;
    }

    const word = PIECE_INDEX[piece] * 64 + square;
    high ^= HIGH[word]!;
    low ^= LOW[word]!;
  }

  if (position.turn === "b") {
    high ^= HIGH[TURN_WORD]!;
    low ^= LOW[TURN_WORD]!;
  }

  const castling = position.castling;
  if (castling.whiteKingSide) {
    high ^= HIGH[CASTLING_WORD]!;
    low ^= LOW[CASTLING_WORD]!;
  }
  if (castling.whiteQueenSide) {
    high ^= HIGH[CASTLING_WORD + 1]!;
    low ^= LOW[CASTLING_WORD + 1]!;
  }
  if (castling.blackKingSide) {
    high ^= HIGH[CASTLING_WORD + 2]!;
    low ^= LOW[CASTLING_WORD + 2]!;
  }
  if (castling.blackQueenSide) {
    high ^= HIGH[CASTLING_WORD + 3]!;
    low ^= LOW[CASTLING_WORD + 3]!;
  }

  // Only a capturable en passant square distinguishes a position, exactly as in
  // `repetitionKey`. A double push nobody can answer is not a different
  // position, and hashing it as one would hide a legitimate repetition.
  if (position.enPassant !== null && enPassantIsCapturable(position)) {
    const word = EN_PASSANT_WORD + fileOf(position.enPassant);
    high ^= HIGH[word]!;
    low ^= LOW[word]!;
  }

  return (high & HIGH_MASK) * LOW_SCALE + (low >>> 0);
}
