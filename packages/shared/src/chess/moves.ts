import {
  fileOf,
  findKing,
  isColor,
  isOnBoard,
  isPiece,
  opposite,
  pieceAt,
  pieceColor,
  rankOf,
  squareAt,
  toPiece,
} from "./board";
import type {
  Board,
  CastlingRights,
  Color,
  Move,
  Piece,
  Position,
  PromotionPiece,
} from "./types";
import { EMPTY } from "./types";

type Delta = readonly [number, number];

const KNIGHT_DELTAS: readonly Delta[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

const KING_DELTAS: readonly Delta[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

const ROOK_DIRECTIONS: readonly Delta[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

const BISHOP_DIRECTIONS: readonly Delta[] = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
];

const PROMOTION_PIECES: readonly PromotionPiece[] = ["q", "r", "b", "n"];

/** The rank a pawn starts on, and the rank it promotes on, per color. */
function pawnRanks(color: Color): { start: number; last: number; dir: number } {
  return color === "w"
    ? { start: 1, last: 7, dir: 1 }
    : { start: 6, last: 0, dir: -1 };
}

function move(partial: Partial<Move> & Pick<Move, "from" | "to" | "piece">): Move {
  return {
    captured: null,
    promotion: null,
    isEnPassant: false,
    isCastle: null,
    isDoublePawnPush: false,
    ...partial,
  };
}

/**
 * Is `square` attacked by any piece of `byColor`? Runs the ray walks outward
 * from the target square rather than scanning every enemy piece, so it stays
 * cheap enough to call once per candidate move during legality filtering.
 */
export function isSquareAttacked(
  board: Board,
  square: number,
  byColor: Color,
): boolean {
  const x = fileOf(square);
  const y = rankOf(square);

  // Pawns. A white pawn attacks diagonally upward, so a white pawn attacking
  // this square must sit one rank below it.
  const pawnDir = byColor === "w" ? -1 : 1;
  const pawn = toPiece("p", byColor);
  for (const dx of [-1, 1]) {
    const px = x + dx;
    const py = y + pawnDir;
    if (isOnBoard(px, py) && pieceAt(board, squareAt(px, py)) === pawn) {
      return true;
    }
  }

  const knight = toPiece("n", byColor);
  for (const [dx, dy] of KNIGHT_DELTAS) {
    const nx = x + dx;
    const ny = y + dy;
    if (isOnBoard(nx, ny) && pieceAt(board, squareAt(nx, ny)) === knight) {
      return true;
    }
  }

  const king = toPiece("k", byColor);
  for (const [dx, dy] of KING_DELTAS) {
    const kx = x + dx;
    const ky = y + dy;
    if (isOnBoard(kx, ky) && pieceAt(board, squareAt(kx, ky)) === king) {
      return true;
    }
  }

  const queen = toPiece("q", byColor);
  const sliders: Array<[readonly Delta[], Piece]> = [
    [ROOK_DIRECTIONS, toPiece("r", byColor)],
    [BISHOP_DIRECTIONS, toPiece("b", byColor)],
  ];

  for (const [directions, slider] of sliders) {
    for (const [dx, dy] of directions) {
      let cx = x + dx;
      let cy = y + dy;

      while (isOnBoard(cx, cy)) {
        const occupant = pieceAt(board, squareAt(cx, cy));
        if (occupant !== EMPTY) {
          if (occupant === slider || occupant === queen) {
            return true;
          }
          break;
        }

        cx += dx;
        cy += dy;
      }
    }
  }

  return false;
}

export function isInCheck(position: Position, color: Color): boolean {
  const king = findKing(position.board, color);
  if (king === null) {
    return false;
  }

  return isSquareAttacked(position.board, king, opposite(color));
}

function addPawnMoves(position: Position, from: number, piece: Piece, out: Move[]) {
  const color = pieceColor(piece);
  const { start, last, dir } = pawnRanks(color);
  const x = fileOf(from);
  const y = rankOf(from);
  const board = position.board;

  const pushY = y + dir;
  if (isOnBoard(x, pushY)) {
    const pushTo = squareAt(x, pushY);
    if (pieceAt(board, pushTo) === EMPTY) {
      if (pushY === last) {
        for (const promotion of PROMOTION_PIECES) {
          out.push(move({ from, to: pushTo, piece, promotion }));
        }
      } else {
        out.push(move({ from, to: pushTo, piece }));

        const doubleY = y + dir * 2;
        if (y === start && pieceAt(board, squareAt(x, doubleY)) === EMPTY) {
          out.push(
            move({
              from,
              to: squareAt(x, doubleY),
              piece,
              isDoublePawnPush: true,
            }),
          );
        }
      }
    }
  }

  for (const dx of [-1, 1]) {
    const cx = x + dx;
    const cy = y + dir;
    if (!isOnBoard(cx, cy)) {
      continue;
    }

    const to = squareAt(cx, cy);
    const target = pieceAt(board, to);

    if (isPiece(target) && pieceColor(target) !== color) {
      if (cy === last) {
        for (const promotion of PROMOTION_PIECES) {
          out.push(move({ from, to, piece, captured: target, promotion }));
        }
      } else {
        out.push(move({ from, to, piece, captured: target }));
      }
      continue;
    }

    if (to === position.enPassant && target === EMPTY) {
      out.push(
        move({
          from,
          to,
          piece,
          captured: toPiece("p", opposite(color)),
          isEnPassant: true,
        }),
      );
    }
  }
}

function addStepMoves(
  position: Position,
  from: number,
  piece: Piece,
  deltas: readonly Delta[],
  out: Move[],
) {
  const color = pieceColor(piece);
  const x = fileOf(from);
  const y = rankOf(from);

  for (const [dx, dy] of deltas) {
    const nx = x + dx;
    const ny = y + dy;
    if (!isOnBoard(nx, ny)) {
      continue;
    }

    const to = squareAt(nx, ny);
    const target = pieceAt(position.board, to);
    if (isColor(target, color)) {
      continue;
    }

    out.push(move({ from, to, piece, captured: isPiece(target) ? target : null }));
  }
}

function addSlidingMoves(
  position: Position,
  from: number,
  piece: Piece,
  directions: readonly Delta[],
  out: Move[],
) {
  const color = pieceColor(piece);
  const x = fileOf(from);
  const y = rankOf(from);

  for (const [dx, dy] of directions) {
    let cx = x + dx;
    let cy = y + dy;

    while (isOnBoard(cx, cy)) {
      const to = squareAt(cx, cy);
      const target = pieceAt(position.board, to);

      if (target === EMPTY) {
        out.push(move({ from, to, piece }));
      } else {
        if (pieceColor(target) !== color) {
          out.push(move({ from, to, piece, captured: target }));
        }
        break;
      }

      cx += dx;
      cy += dy;
    }
  }
}

function addCastlingMoves(position: Position, piece: Piece, out: Move[]) {
  const color = pieceColor(piece);
  const board = position.board;
  const homeRank = color === "w" ? 0 : 7;
  const kingFrom = squareAt(4, homeRank);

  // A king that has been displaced can't castle; rights alone aren't enough to
  // trust, because a test FEN may hand us rights with the king elsewhere.
  if (pieceAt(board, kingFrom) !== piece) {
    return;
  }

  const enemy = opposite(color);
  if (isSquareAttacked(board, kingFrom, enemy)) {
    return;
  }

  const rook = toPiece("r", color);
  const sides: CastleSideConfig[] = [
    {
      side: "king",
      allowed:
        color === "w"
          ? position.castling.whiteKingSide
          : position.castling.blackKingSide,
      rookFrom: squareAt(7, homeRank),
      empty: [squareAt(5, homeRank), squareAt(6, homeRank)],
      safe: [squareAt(5, homeRank), squareAt(6, homeRank)],
      kingTo: squareAt(6, homeRank),
    },
    {
      side: "queen",
      allowed:
        color === "w"
          ? position.castling.whiteQueenSide
          : position.castling.blackQueenSide,
      rookFrom: squareAt(0, homeRank),
      empty: [
        squareAt(1, homeRank),
        squareAt(2, homeRank),
        squareAt(3, homeRank),
      ],
      // b1/b8 may be attacked; the king never crosses it.
      safe: [squareAt(2, homeRank), squareAt(3, homeRank)],
      kingTo: squareAt(2, homeRank),
    },
  ];

  for (const config of sides) {
    if (!config.allowed || pieceAt(board, config.rookFrom) !== rook) {
      continue;
    }

    if (config.empty.some((square) => pieceAt(board, square) !== EMPTY)) {
      continue;
    }

    if (config.safe.some((square) => isSquareAttacked(board, square, enemy))) {
      continue;
    }

    out.push(
      move({ from: kingFrom, to: config.kingTo, piece, isCastle: config.side }),
    );
  }
}

type CastleSideConfig = {
  side: "king" | "queen";
  allowed: boolean;
  rookFrom: number;
  /** Squares between king and rook that must be vacant. */
  empty: number[];
  /** Squares the king crosses or lands on, which must not be attacked. */
  safe: number[];
  kingTo: number;
};

/** Every move the side to move could make ignoring whether it leaves the king in check. */
export function generatePseudoLegalMoves(position: Position): Move[] {
  const out: Move[] = [];

  for (let square = 0; square < 64; square++) {
    const piece = pieceAt(position.board, square);
    if (!isPiece(piece) || pieceColor(piece) !== position.turn) {
      continue;
    }

    switch (piece.toLowerCase()) {
      case "p":
        addPawnMoves(position, square, piece, out);
        break;
      case "n":
        addStepMoves(position, square, piece, KNIGHT_DELTAS, out);
        break;
      case "b":
        addSlidingMoves(position, square, piece, BISHOP_DIRECTIONS, out);
        break;
      case "r":
        addSlidingMoves(position, square, piece, ROOK_DIRECTIONS, out);
        break;
      case "q":
        addSlidingMoves(
          position,
          square,
          piece,
          [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS],
          out,
        );
        break;
      case "k":
        addStepMoves(position, square, piece, KING_DELTAS, out);
        addCastlingMoves(position, piece, out);
        break;
    }
  }

  return out;
}

/**
 * Whether `candidate` leaves the side that played it with a safe king — the one
 * condition that separates a pseudo-legal move from a legal one. It covers pins,
 * check evasions, and the rare en-passant discovered check for free, because
 * `applyMove` really does lift both pawns off the board.
 *
 * This is the expensive half of move generation: a board copy and a ray scan per
 * candidate. Everything below is arranged to run it on as few moves as possible.
 */
function leavesKingSafe(position: Position, candidate: Move): boolean {
  const color = position.turn;
  const next = applyMove(position, candidate);
  return !isInCheck({ ...next, turn: color }, color);
}

/** The legal moves for the side to move. */
export function generateLegalMoves(position: Position): Move[] {
  return generatePseudoLegalMoves(position).filter((candidate) =>
    leavesKingSafe(position, candidate),
  );
}

/**
 * The legal captures and promotions for the side to move — the moves a
 * quiescence search extends into.
 *
 * Filtering the pseudo-legal list *before* the legality check is the whole
 * point. A quiet middlegame position offers thirty-odd moves and two captures,
 * so `generateLegalMoves(...).filter(isCapture)` would pay for thirty board
 * copies to keep two; this pays for two.
 */
export function generateLegalCaptures(position: Position): Move[] {
  return generatePseudoLegalMoves(position)
    .filter((move) => move.captured !== null || move.promotion !== null)
    .filter((candidate) => leavesKingSafe(position, candidate));
}

/**
 * Whether the side to move has any legal move at all, stopping at the first one
 * found. This is how a search that only generated captures tells a genuinely
 * quiet position from a stalemate without paying for the full legal list — in
 * a position with moves it almost always returns on the first candidate.
 */
export function hasLegalMove(position: Position): boolean {
  return generatePseudoLegalMoves(position).some((candidate) =>
    leavesKingSafe(position, candidate),
  );
}

/** The legal moves that start from `square`. */
export function movesFrom(position: Position, square: number): Move[] {
  return generateLegalMoves(position).filter((m) => m.from === square);
}

function updateCastlingRights(
  rights: CastlingRights,
  move: Move,
): CastlingRights {
  const next = { ...rights };
  const type = move.piece.toLowerCase();

  if (type === "k") {
    if (pieceColor(move.piece) === "w") {
      next.whiteKingSide = false;
      next.whiteQueenSide = false;
    } else {
      next.blackKingSide = false;
      next.blackQueenSide = false;
    }
  }

  // A rook leaving its home square, or being captured on it, kills that right.
  // Checking squares rather than piece identity covers both cases at once.
  for (const square of [move.from, move.to]) {
    if (square === squareAt(0, 0)) next.whiteQueenSide = false;
    if (square === squareAt(7, 0)) next.whiteKingSide = false;
    if (square === squareAt(0, 7)) next.blackQueenSide = false;
    if (square === squareAt(7, 7)) next.blackKingSide = false;
  }

  return next;
}

/** Play `move` and return the resulting position. The input is never mutated. */
export function applyMove(position: Position, move: Move): Position {
  const board = position.board.slice();
  const color = pieceColor(move.piece);

  board[move.from] = EMPTY;

  if (move.isEnPassant) {
    // The captured pawn sits beside our starting square, not on the target.
    const captured = squareAt(fileOf(move.to), rankOf(move.from));
    board[captured] = EMPTY;
  }

  board[move.to] = move.promotion
    ? toPiece(move.promotion, color)
    : move.piece;

  if (move.isCastle) {
    const homeRank = color === "w" ? 0 : 7;
    const [rookFrom, rookTo] =
      move.isCastle === "king"
        ? [squareAt(7, homeRank), squareAt(5, homeRank)]
        : [squareAt(0, homeRank), squareAt(3, homeRank)];

    board[rookFrom] = EMPTY;
    board[rookTo] = toPiece("r", color);
  }

  const isPawnMove = move.piece.toLowerCase() === "p";
  const resetsClock = isPawnMove || move.captured !== null;

  return {
    board,
    turn: opposite(color),
    castling: updateCastlingRights(position.castling, move),
    enPassant: move.isDoublePawnPush
      ? squareAt(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
      : null,
    halfmoveClock: resetsClock ? 0 : position.halfmoveClock + 1,
    fullmoveNumber:
      color === "b" ? position.fullmoveNumber + 1 : position.fullmoveNumber,
  };
}

/**
 * Neither side can deliver mate with the material on the board: bare kings,
 * king and minor piece, or same-colored bishops only.
 */
export function isInsufficientMaterial(position: Position): boolean {
  const bishops: number[] = [];
  let knights = 0;

  for (let square = 0; square < 64; square++) {
    const piece = pieceAt(position.board, square);
    if (!isPiece(piece)) {
      continue;
    }

    switch (piece.toLowerCase()) {
      case "k":
        break;
      case "b":
        bishops.push(square);
        break;
      case "n":
        knights += 1;
        break;
      default:
        // A pawn, rook, or queen is always enough for someone to mate with.
        return false;
    }
  }

  if (knights === 0 && bishops.length === 0) {
    return true;
  }

  if (bishops.length === 0 && knights === 1) {
    return true;
  }

  if (knights === 0 && bishops.length === 1) {
    return true;
  }

  if (knights === 0 && bishops.length > 1) {
    // Any number of bishops draws only while they all sit on one square color.
    const squareColor = (square: number) =>
      (fileOf(square) + rankOf(square)) % 2;
    const first = squareColor(bishops[0] as number);
    return bishops.every((square) => squareColor(square) === first);
  }

  return false;
}

export function findMove(
  moves: Move[],
  from: number,
  to: number,
  promotion?: PromotionPiece,
): Move | undefined {
  return moves.find(
    (m) =>
      m.from === from &&
      m.to === to &&
      (promotion === undefined || m.promotion === promotion),
  );
}
