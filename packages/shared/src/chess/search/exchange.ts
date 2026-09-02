import {
  fileOf,
  opposite,
  pieceColor,
  rankOf,
  squareAt,
  toPiece,
} from "../board";
import {
  BISHOP_DIRECTIONS,
  KING_DELTAS,
  KNIGHT_DELTAS,
  ROOK_DIRECTIONS,
} from "../moves";
import type { Board, Color, Move, PieceType, Position } from "../types";
import { EMPTY } from "../types";

/* -------------------------------------------------------------------------- */
/* Static exchange evaluation                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Material for weighing an exchange. The king carries a value here — unlike in
 * `evaluate`, where it cancels out — because the swap below has to understand
 * that recapturing with the king is not free.
 */
export const EXCHANGE_VALUES: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 10_000,
};

export function exchangeValueOf(piece: string): number {
  return EXCHANGE_VALUES[piece.toLowerCase() as PieceType] ?? 0;
}

/**
 * The square of the least valuable piece of `color` attacking `square`, or -1.
 *
 * Cheapest first is what makes an exchange sequence meaningful: a defender takes
 * with its pawn before its queen, and a sequence resolved in any other order
 * would misprice the trade.
 */
function leastValuableAttacker(
  board: Board,
  square: number,
  color: Color,
): number {
  const x = fileOf(square);
  const y = rankOf(square);

  // A white pawn attacking this square stands one rank below it.
  const pawnRank = y + (color === "w" ? -1 : 1);
  if (pawnRank >= 0 && pawnRank <= 7) {
    const pawn = toPiece("p", color);
    if (x > 0 && board[squareAt(x - 1, pawnRank)] === pawn) {
      return squareAt(x - 1, pawnRank);
    }
    if (x < 7 && board[squareAt(x + 1, pawnRank)] === pawn) {
      return squareAt(x + 1, pawnRank);
    }
  }

  const knight = toPiece("n", color);
  for (const [dx, dy] of KNIGHT_DELTAS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx > 7 || ny < 0 || ny > 7) {
      continue;
    }
    if (board[squareAt(nx, ny)] === knight) {
      return squareAt(nx, ny);
    }
  }

  // The sliders are walked once per direction set, and the first piece each ray
  // meets is the only one that can attack along it — anything behind is blocked
  // until that piece is taken off, which the caller does before asking again.
  const bishop = toPiece("b", color);
  const rook = toPiece("r", color);
  const queen = toPiece("q", color);

  let queenSquare = -1;

  for (const [directions, slider] of [
    [BISHOP_DIRECTIONS, bishop],
    [ROOK_DIRECTIONS, rook],
  ] as const) {
    for (const [dx, dy] of directions) {
      let cx = x + dx;
      let cy = y + dy;

      while (cx >= 0 && cx <= 7 && cy >= 0 && cy <= 7) {
        const occupant = board[squareAt(cx, cy)];
        if (occupant !== EMPTY && occupant !== undefined) {
          if (occupant === slider) {
            return squareAt(cx, cy);
          }
          if (occupant === queen && queenSquare === -1) {
            queenSquare = squareAt(cx, cy);
          }
          break;
        }

        cx += dx;
        cy += dy;
      }
    }
  }

  if (queenSquare !== -1) {
    return queenSquare;
  }

  const king = toPiece("k", color);
  for (const [dx, dy] of KING_DELTAS) {
    const kx = x + dx;
    const ky = y + dy;
    if (kx < 0 || kx > 7 || ky < 0 || ky > 7) {
      continue;
    }
    if (board[squareAt(kx, ky)] === king) {
      return squareAt(kx, ky);
    }
  }

  return -1;
}

/**
 * Scratch space for `see`. The exchange is played out by mutating a copy of the
 * board — which is what makes the x-rays work, since taking a piece off reveals
 * whatever stood behind it — and reusing one array keeps that out of the
 * allocator's way.
 */
const exchangeBoard: Board = new Array<string>(64).fill(EMPTY) as Board;

const exchangeGains = new Int32Array(40);

/**
 * Static exchange evaluation: the material the mover comes out ahead by if every
 * capture available on the target square is played out, cheapest piece first.
 *
 * This is what tells a capture that wins a pawn and loses a rook from one that
 * simply wins a pawn, without searching either. The quiescence search uses it to
 * throw out losing captures outright, and the main search to order the rest.
 */
export function see(position: Position, move: Move): number {
  const target = move.to;

  for (let square = 0; square < 64; square += 1) {
    exchangeBoard[square] = position.board[square] ?? EMPTY;
  }

  const mover = pieceColor(move.piece);

  // What the move itself wins. An en passant capture takes a pawn that is not
  // standing on the target square, and a promotion is worth the difference
  // between the pawn that left and the piece that arrived.
  let won = move.isEnPassant
    ? EXCHANGE_VALUES.p
    : exchangeValueOf(exchangeBoard[target] ?? EMPTY);

  if (move.isEnPassant) {
    exchangeBoard[squareAt(fileOf(move.to), rankOf(move.from))] = EMPTY;
  }
  if (move.promotion !== null) {
    won += EXCHANGE_VALUES[move.promotion] - EXCHANGE_VALUES.p;
  }

  exchangeBoard[move.from] = EMPTY;
  exchangeBoard[target] =
    move.promotion !== null ? toPiece(move.promotion, mover) : move.piece;

  let depth = 0;
  exchangeGains[0] = won;
  let side = opposite(mover);

  while (depth < exchangeGains.length - 1) {
    const from = leastValuableAttacker(exchangeBoard, target, side);
    if (from === -1) {
      break;
    }

    depth += 1;
    // Taking on the target square wins whatever is standing there, against
    // everything the other side has already banked.
    exchangeGains[depth] =
      exchangeValueOf(exchangeBoard[target] ?? EMPTY) -
      exchangeGains[depth - 1]!;

    const attacker = exchangeBoard[from]!;
    exchangeBoard[from] = EMPTY;
    exchangeBoard[target] = attacker;
    side = opposite(side);
  }

  // Fold the sequence back. At every step the side to move could have declined
  // to continue, so a capture is only worth taking if the reply to it is worse
  // for the opponent than stopping — which is what the negated maximum says.
  while (depth > 0) {
    exchangeGains[depth - 1] = -Math.max(
      -exchangeGains[depth - 1]!,
      exchangeGains[depth]!,
    );
    depth -= 1;
  }

  return exchangeGains[0]!;
}
