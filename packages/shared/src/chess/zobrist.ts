import { fileOf, isPiece } from "./board";
import { hasLegalEnPassant } from "./moves";
import type { Piece, Position } from "./types";

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

const HIGH_MASK = 0x1fffff;
const LOW_SCALE = 4294967296;

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

  if (position.enPassant !== null && hasLegalEnPassant(position)) {
    const word = EN_PASSANT_WORD + fileOf(position.enPassant);
    high ^= HIGH[word]!;
    low ^= LOW[word]!;
  }

  return (high & HIGH_MASK) * LOW_SCALE + (low >>> 0);
}
