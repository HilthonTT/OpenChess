import {
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

/**
 * A step across the board as `[files, ranks]`. Exported along with the delta
 * sets below so the search can walk the same geometry — an engine that decides
 * exchanges by its own copy of the knight's moves is one bad edit from
 * disagreeing with the rules.
 */
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

/** The rank a pawn starts on, and the rank it promotes on, per color. */
function pawnRanks(color: Color): { start: number; last: number; dir: number } {
  return color === "w"
    ? { start: 1, last: 7, dir: 1 }
    : { start: 6, last: 0, dir: -1 };
}

/**
 * Every field written out in a fixed order rather than spread over defaults.
 * Spreading a partial gives each call site's shape its own layout, and the search
 * then reads `captured` and `promotion` off half a dozen different shapes a
 * million times a move; naming the fields here means every `Move` in the program
 * has one layout and those reads stay cheap.
 */
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

/**
 * Where a castle *ends*, which is the one part of the rule that never moves.
 * The king finishes on the g- or c-file and the rook beside it on the f- or
 * d-file whatever files the two of them started on, which is what makes a
 * shuffled game's castling recognisably the same move as a normal one.
 */
const CASTLE_KING_FILE: Record<CastleSide, number> = { king: 6, queen: 2 };
const CASTLE_ROOK_FILE: Record<CastleSide, number> = { king: 5, queen: 3 };

/** The right `side` needs, named as it is on `CastlingRights`. */
function castlingRightKey(
  color: Color,
  side: CastleSide,
): keyof CastlingRights {
  if (color === "w") {
    return side === "king" ? "whiteKingSide" : "whiteQueenSide";
  }
  return side === "king" ? "blackKingSide" : "blackQueenSide";
}

/** Where the rook that castles to `side` began, for `color`. */
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

/** Where the king and rook stand once `side` has been castled to. */
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

/**
 * Every square from `fromFile` to `toFile` along `rank` is empty, ignoring the
 * two squares the castling king and rook are themselves standing on.
 *
 * The exemptions are what makes this work on a shuffled array, where the king's
 * destination is routinely the rook's starting square and vice versa: those two
 * are about to swap, so finding each other in the way is not an obstruction.
 */
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

/** No square the king starts on, crosses, or lands on is attacked. */
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

  // A king that has been displaced can't castle; rights alone aren't enough to
  // trust, because a test FEN may hand us rights with the king elsewhere.
  if (pieceAt(board, kingFrom) !== piece) {
    return;
  }

  const enemy = opposite(color);

  // Castling out of check is illegal on either side, so it is worth answering
  // once here rather than inside each side's walk.
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

    // Both journeys have to be clear, and between them they cover every square
    // the rule cares about — including b1/b8, which only the rook crosses and
    // which the king is therefore allowed to be attacked on.
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
        // In a shuffled game the king's castling destination is frequently a
        // square it could also reach as an ordinary king move — b1-c1 is both
        // "king steps right" and "castles queenside" — so naming that square
        // would make one move description mean two moves. Castling is written
        // king-takes-rook there instead, as every Chess960 implementation
        // writes it, and that can never collide: the square holds the mover's
        // own rook, so no plain king move goes to it.
        to: standard ? squareAt(kingToFile, homeRank) : rookFrom,
        piece,
        isCastle: side,
      }),
    );
  }
}

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
 * check evasions, and the rare en-passant discovered check for free, because the
 * pawn taken en passant really is lifted off the board below.
 *
 * This is the expensive half of move generation, and it runs on every candidate:
 * around thirty times per position, and the search asks for a position's moves
 * hundreds of thousands of times a move. That is why it plays `candidate` onto
 * the board in place and takes it back off again rather than building the
 * position that follows — a `Position` is immutable everywhere else, and this is
 * the one place that would rather have the array back than a copy of it.
 *
 * Nothing can observe the board mid-move: the mutation and its undo sit in one
 * synchronous stretch with no allocation, no callback and no throw between them,
 * and the two helpers in between only read.
 */
function leavesKingSafe(
  position: Position,
  candidate: Move,
  kingSquare: number,
): boolean {
  const board = position.board;
  const color = position.turn;
  const { from, to } = candidate;

  // Castling moves four squares' worth of board around and, on a shuffled
  // array, those four squares overlap — the king's destination is often the
  // rook's origin. That makes the "lift, place, put back" dance below wrong in
  // a way no amount of ordering fixes, so a castle gets its own path where
  // every touched square is saved up front and restored from that snapshot.
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

  // The pawn taken en passant stands beside the starting square, not on the
  // target — which is exactly why a discovered check along that rank is a real
  // possibility and has to be tested on a board with the pawn gone.
  let enPassantSquare = -1;
  let enPassantPawn: SquareContent = EMPTY;
  if (candidate.isEnPassant) {
    enPassantSquare = squareAt(fileOf(to), rankOf(from));
    enPassantPawn = board[enPassantSquare] as SquareContent;
    board[enPassantSquare] = EMPTY;
  }

  // A king that just moved is on the square it moved to; every other move leaves
  // it where the caller already found it.
  const king = candidate.piece.toLowerCase() === "k" ? to : kingSquare;
  const safe = king < 0 || !isSquareAttacked(board, king, opposite(color));

  if (enPassantSquare !== -1) {
    board[enPassantSquare] = enPassantPawn;
  }
  board[to] = replaced as SquareContent;
  board[from] = moved as SquareContent;

  return safe;
}

/**
 * The same in-place test for a castle.
 *
 * Castling cannot walk into check — `addCastlingMoves` already refused every
 * square the king crosses — but the rook lands somewhere new, and on the back
 * rank it can be the piece that was blocking a check on the king's destination.
 * That is the one thing left to test, so the rook has to be down when it runs.
 *
 * The four squares are snapshotted before anything is written and restored from
 * that snapshot afterwards, which stays correct however they overlap: writing a
 * square twice with the value it started with is the same as writing it once.
 */
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

/**
 * Where the side to move's king stands, or -1 when the position has no king —
 * which a hand-written test FEN is allowed to do.
 *
 * Found once and handed to every legality check, rather than rediscovered inside
 * each of them: the king only moves on a king move, and scanning the board for it
 * thirty-odd times per position was a fifth of the cost of generating them.
 */
function kingSquareOf(position: Position): number {
  return findKing(position.board, position.turn) ?? -1;
}

/** The legal moves for the side to move. */
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

/**
 * Whether the side to move has any legal move at all, stopping at the first one
 * found. This is how a search that only generated captures tells a genuinely
 * quiet position from a stalemate without paying for the full legal list — in
 * a position with moves it almost always returns on the first candidate.
 */
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

/** The legal moves that start from `square`. */
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

  // A rook leaving its home square, or being captured on it, kills that right.
  // Checking squares rather than piece identity covers both cases at once —
  // and the squares are read from the position rather than assumed to be the
  // corners, which is the whole of what a shuffled array changes here.
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

  if (move.isCastle) {
    const rookFrom = castlingRookSquare(position, color, move.isCastle);
    const { kingTo, rookTo } = castlingDestinations(color, move.isCastle);

    // Both pieces are lifted before either is put down. On a shuffled array the
    // king's destination is often the rook's starting square — and the rook's
    // destination the king's — so placing one before lifting the other would
    // quietly delete a piece.
    //
    // The king lands on `kingTo` rather than on `move.to`: in a shuffled game
    // the move is written king-takes-rook, so `move.to` is where the *rook*
    // was, not where the king is going.
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
