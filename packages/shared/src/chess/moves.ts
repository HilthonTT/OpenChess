import {
  enPassantIsCapturable,
  fileOf,
  findKing,
  homeRankOf,
  isColor,
  isOnBoard,
  isPiece,
  isStandardCastlingFiles,
  opposite,
  pieceAt,
  pieceColor,
  rankOf,
  squareAt,
  toFen,
  toPiece,
} from "./board";
import type {
  Board,
  CastleSide,
  CastlingRights,
  Color,
  Move,
  Piece,
  Position,
  PromotionPiece,
  SquareContent,
} from "./types";
import { EMPTY } from "./types";

export type Delta = readonly [number, number];

export const KNIGHT_DELTAS: readonly Delta[] = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

export const KING_DELTAS: readonly Delta[] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

export const ROOK_DIRECTIONS: readonly Delta[] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export const BISHOP_DIRECTIONS: readonly Delta[] = [
  [1, 1],
  [1, -1],
  [-1, -1],
  [-1, 1],
];

const PROMOTION_PIECES: readonly PromotionPiece[] = ["q", "r", "b", "n"];

function pawnRanks(color: Color): { start: number; last: number; dir: number } {
  return color === "w"
    ? { start: 1, last: 7, dir: 1 }
    : { start: 6, last: 0, dir: -1 };
}

function move(
  partial: Partial<Move> & Pick<Move, "from" | "to" | "piece">,
): Move {
  return {
    from: partial.from,
    to: partial.to,
    piece: partial.piece,
    captured: partial.captured ?? null,
    promotion: partial.promotion ?? null,
    isEnPassant: partial.isEnPassant ?? false,
    isCastle: partial.isCastle ?? null,
    isDoublePawnPush: partial.isDoublePawnPush ?? false,
  };
}

export function isSquareAttacked(
  board: Board,
  square: number,
  byColor: Color,
): boolean {
  const x = fileOf(square);
  const y = rankOf(square);

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

function addPawnMoves(
  position: Position,
  from: number,
  piece: Piece,
  out: Move[],
) {
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

    out.push(
      move({ from, to, piece, captured: isPiece(target) ? target : null }),
    );
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

const CASTLE_KING_FILE: Record<CastleSide, number> = { king: 6, queen: 2 };
const CASTLE_ROOK_FILE: Record<CastleSide, number> = { king: 5, queen: 3 };

function castlingRightKey(
  color: Color,
  side: CastleSide,
): keyof CastlingRights {
  if (color === "w") {
    return side === "king" ? "whiteKingSide" : "whiteQueenSide";
  }
  return side === "king" ? "blackKingSide" : "blackQueenSide";
}

export function castlingRookSquare(
  position: Position,
  color: Color,
  side: CastleSide,
): number {
  const files = position.castlingFiles[color];
  return squareAt(
    side === "king" ? files.kingRook : files.queenRook,
    homeRankOf(color),
  );
}

export function castlingDestinations(
  color: Color,
  side: CastleSide,
): { kingTo: number; rookTo: number } {
  const rank = homeRankOf(color);
  return {
    kingTo: squareAt(CASTLE_KING_FILE[side], rank),
    rookTo: squareAt(CASTLE_ROOK_FILE[side], rank),
  };
}

function fileRangeIsClear(
  board: Board,
  rank: number,
  fromFile: number,
  toFile: number,
  kingFrom: number,
  rookFrom: number,
): boolean {
  const low = Math.min(fromFile, toFile);
  const high = Math.max(fromFile, toFile);

  for (let file = low; file <= high; file += 1) {
    const square = squareAt(file, rank);
    if (square === kingFrom || square === rookFrom) {
      continue;
    }
    if (pieceAt(board, square) !== EMPTY) {
      return false;
    }
  }

  return true;
}

function kingWalkIsSafe(
  board: Board,
  rank: number,
  fromFile: number,
  toFile: number,
  enemy: Color,
): boolean {
  const low = Math.min(fromFile, toFile);
  const high = Math.max(fromFile, toFile);

  for (let file = low; file <= high; file += 1) {
    if (isSquareAttacked(board, squareAt(file, rank), enemy)) {
      return false;
    }
  }

  return true;
}

function addCastlingMoves(position: Position, piece: Piece, out: Move[]) {
  const color = pieceColor(piece);
  const board = position.board;
  const homeRank = homeRankOf(color);
  const files = position.castlingFiles[color];
  const kingFrom = squareAt(files.king, homeRank);

  if (pieceAt(board, kingFrom) !== piece) {
    return;
  }

  const enemy = opposite(color);

  if (isSquareAttacked(board, kingFrom, enemy)) {
    return;
  }

  const rook = toPiece("r", color);
  const standard = isStandardCastlingFiles(files);

  for (const side of ["king", "queen"] as const) {
    if (!position.castling[castlingRightKey(color, side)]) {
      continue;
    }

    const rookFile = side === "king" ? files.kingRook : files.queenRook;
    const rookFrom = squareAt(rookFile, homeRank);
    if (pieceAt(board, rookFrom) !== rook) {
      continue;
    }

    const kingToFile = CASTLE_KING_FILE[side];
    const rookToFile = CASTLE_ROOK_FILE[side];

    if (
      !fileRangeIsClear(
        board,
        homeRank,
        files.king,
        kingToFile,
        kingFrom,
        rookFrom,
      ) ||
      !fileRangeIsClear(
        board,
        homeRank,
        rookFile,
        rookToFile,
        kingFrom,
        rookFrom,
      )
    ) {
      continue;
    }

    if (!kingWalkIsSafe(board, homeRank, files.king, kingToFile, enemy)) {
      continue;
    }

    out.push(
      move({
        from: kingFrom,
        to: standard ? squareAt(kingToFile, homeRank) : rookFrom,
        piece,
        isCastle: side,
      }),
    );
  }
}

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

function leavesKingSafe(
  position: Position,
  candidate: Move,
  kingSquare: number,
): boolean {
  const board = position.board;
  const color = position.turn;
  const { from, to } = candidate;

  if (candidate.isCastle !== null) {
    return castleLeavesKingSafe(position, candidate);
  }

  const moved = board[from];
  const replaced = board[to];

  board[from] = EMPTY;
  board[to] =
    candidate.promotion !== null
      ? toPiece(candidate.promotion, color)
      : (moved as Piece);

  let enPassantSquare = -1;
  let enPassantPawn: SquareContent = EMPTY;
  if (candidate.isEnPassant) {
    enPassantSquare = squareAt(fileOf(to), rankOf(from));
    enPassantPawn = board[enPassantSquare] as SquareContent;
    board[enPassantSquare] = EMPTY;
  }

  const king = candidate.piece.toLowerCase() === "k" ? to : kingSquare;
  const safe = king < 0 || !isSquareAttacked(board, king, opposite(color));

  if (enPassantSquare !== -1) {
    board[enPassantSquare] = enPassantPawn;
  }
  board[to] = replaced as SquareContent;
  board[from] = moved as SquareContent;

  return safe;
}

function castleLeavesKingSafe(position: Position, candidate: Move): boolean {
  const board = position.board;
  const color = position.turn;
  const side = candidate.isCastle as CastleSide;

  const kingFrom = candidate.from;
  const rookFrom = castlingRookSquare(position, color, side);
  const { kingTo, rookTo } = castlingDestinations(color, side);

  const wasKingFrom = board[kingFrom] as SquareContent;
  const wasRookFrom = board[rookFrom] as SquareContent;
  const wasKingTo = board[kingTo] as SquareContent;
  const wasRookTo = board[rookTo] as SquareContent;

  board[kingFrom] = EMPTY;
  board[rookFrom] = EMPTY;
  board[kingTo] = candidate.piece;
  board[rookTo] = toPiece("r", color);

  const safe = !isSquareAttacked(board, kingTo, opposite(color));

  board[kingFrom] = wasKingFrom;
  board[rookFrom] = wasRookFrom;
  board[kingTo] = wasKingTo;
  board[rookTo] = wasRookTo;

  return safe;
}

function kingSquareOf(position: Position): number {
  return findKing(position.board, position.turn) ?? -1;
}

export function generateLegalMoves(position: Position): Move[] {
  const candidates = generatePseudoLegalMoves(position);
  const king = kingSquareOf(position);
  const legal: Move[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (leavesKingSafe(position, candidate, king)) {
      legal.push(candidate);
    }
  }

  return legal;
}

export function generateLegalCaptures(position: Position): Move[] {
  const candidates = generatePseudoLegalMoves(position);
  const king = kingSquareOf(position);
  const captures: Move[] = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!;
    if (candidate.captured === null && candidate.promotion === null) {
      continue;
    }
    if (leavesKingSafe(position, candidate, king)) {
      captures.push(candidate);
    }
  }

  return captures;
}

export function hasLegalMove(position: Position): boolean {
  const candidates = generatePseudoLegalMoves(position);
  const king = kingSquareOf(position);

  for (let index = 0; index < candidates.length; index += 1) {
    if (leavesKingSafe(position, candidates[index]!, king)) {
      return true;
    }
  }

  return false;
}

export function movesFrom(position: Position, square: number): Move[] {
  return generateLegalMoves(position).filter((m) => m.from === square);
}

function updateCastlingRights(position: Position, move: Move): CastlingRights {
  const next = { ...position.castling };
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

  for (const square of [move.from, move.to]) {
    for (const color of ["w", "b"] as const) {
      for (const side of ["king", "queen"] as const) {
        if (square === castlingRookSquare(position, color, side)) {
          next[castlingRightKey(color, side)] = false;
        }
      }
    }
  }

  return next;
}

export function applyMove(position: Position, move: Move): Position {
  const board = position.board.slice();
  const color = pieceColor(move.piece);

  board[move.from] = EMPTY;

  if (move.isEnPassant) {
    const captured = squareAt(fileOf(move.to), rankOf(move.from));
    board[captured] = EMPTY;
  }

  if (move.isCastle) {
    const rookFrom = castlingRookSquare(position, color, move.isCastle);
    const { kingTo, rookTo } = castlingDestinations(color, move.isCastle);

    board[rookFrom] = EMPTY;
    board[kingTo] = move.piece;
    board[rookTo] = toPiece("r", color);
  } else {
    board[move.to] = move.promotion
      ? toPiece(move.promotion, color)
      : move.piece;
  }

  const isPawnMove = move.piece.toLowerCase() === "p";
  const resetsClock = isPawnMove || move.captured !== null;

  return {
    board,
    turn: opposite(color),
    castling: updateCastlingRights(position, move),
    castlingFiles: position.castlingFiles,
    enPassant: move.isDoublePawnPush
      ? squareAt(fileOf(move.from), (rankOf(move.from) + rankOf(move.to)) / 2)
      : null,
    halfmoveClock: resetsClock ? 0 : position.halfmoveClock + 1,
    fullmoveNumber:
      color === "b" ? position.fullmoveNumber + 1 : position.fullmoveNumber,
  };
}

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

export function hasLegalEnPassant(position: Position): boolean {
  if (!enPassantIsCapturable(position)) {
    return false;
  }

  const king = kingSquareOf(position);
  return generatePseudoLegalMoves(position).some(
    (candidate) =>
      candidate.isEnPassant && leavesKingSafe(position, candidate, king),
  );
}

export function repetitionKey(position: Position): string {
  const fields = toFen(position).split(" ").slice(0, 4);

  if (position.enPassant !== null && !hasLegalEnPassant(position)) {
    fields[3] = "-";
  }

  return fields.join(" ");
}
