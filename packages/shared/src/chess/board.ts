import type {
  Board,
  CastlingFiles,
  CastlingRights,
  CastlingSetup,
  Color,
  Piece,
  Position,
  SquareContent,
} from "./types";
import { EMPTY } from "./types";

export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const FILES = "abcdefgh";

/**
 * Squares are stored in FEN order (index 0 = a8, index 63 = h1) but reasoned
 * about in board coordinates: `x` counts files left to right (0 = a) and `y`
 * counts ranks bottom to top (0 = rank 1). White therefore advances as `y`
 * grows, which keeps the pawn and castling code readable.
 */
export function squareAt(x: number, y: number): number {
  return (7 - y) * 8 + x;
}

export function fileOf(square: number): number {
  return square % 8;
}

export function rankOf(square: number): number {
  return 7 - Math.floor(square / 8);
}

export function isOnBoard(x: number, y: number): boolean {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

/** "e4" -> square index. Returns null for anything that isn't a square name. */
export function fromAlgebraic(name: string): number | null {
  if (name.length !== 2) {
    return null;
  }

  const x = FILES.indexOf(name[0] as string);
  const y = Number(name[1]) - 1;
  if (x < 0 || !isOnBoard(x, y)) {
    return null;
  }

  return squareAt(x, y);
}

/** Square index -> "e4". */
export function toAlgebraic(square: number): string {
  return `${FILES[fileOf(square)]}${rankOf(square) + 1}`;
}

export function pieceColor(piece: Piece): Color {
  return piece === piece.toUpperCase() ? "w" : "b";
}

export function isPiece(square: SquareContent): square is Piece {
  return square !== EMPTY;
}

/** True when `square` holds a piece belonging to `color`. */
export function isColor(square: SquareContent, color: Color): boolean {
  return isPiece(square) && pieceColor(square) === color;
}

export function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

/** Cast a piece kind to the FEN letter for `color`. */
export function toPiece(type: string, color: Color): Piece {
  return (color === "w" ? type.toUpperCase() : type.toLowerCase()) as Piece;
}

export function emptyBoard(): Board {
  return Array<SquareContent>(64).fill(EMPTY);
}

export function pieceAt(board: Board, square: number): SquareContent {
  return board[square] ?? EMPTY;
}

/** Locate `color`'s king, or null if it has none (only reachable in test positions). */
export function findKing(board: Board, color: Color): number | null {
  const king: Piece = color === "w" ? "K" : "k";
  const square = board.indexOf(king);
  return square === -1 ? null : square;
}

const CASTLING_ORDER: Array<[keyof CastlingRights, string]> = [
  ["whiteKingSide", "K"],
  ["whiteQueenSide", "Q"],
  ["blackKingSide", "k"],
  ["blackQueenSide", "q"],
];

export function noCastlingRights(): CastlingRights {
  return {
    whiteKingSide: false,
    whiteQueenSide: false,
    blackKingSide: false,
    blackQueenSide: false,
  };
}

/** Where castling starts from in standard chess: king e, rooks a and h. */
export const STANDARD_CASTLING_FILES: CastlingFiles = {
  king: 4,
  queenRook: 0,
  kingRook: 7,
};

export function standardCastlingSetup(): CastlingSetup {
  return {
    w: { ...STANDARD_CASTLING_FILES },
    b: { ...STANDARD_CASTLING_FILES },
  };
}

export function isStandardCastlingFiles(files: CastlingFiles): boolean {
  return (
    files.king === STANDARD_CASTLING_FILES.king &&
    files.queenRook === STANDARD_CASTLING_FILES.queenRook &&
    files.kingRook === STANDARD_CASTLING_FILES.kingRook
  );
}

/**
 * Whether both sides castle from the standard squares — i.e. this is an
 * ordinary game rather than a shuffled one. What decides whether a FEN writes
 * `KQkq` or names the rooks' files, and whether a castling move is written in
 * UCI as the king's two squares or as king-takes-rook.
 */
export function isStandardCastlingSetup(setup: CastlingSetup): boolean {
  return isStandardCastlingFiles(setup.w) && isStandardCastlingFiles(setup.b);
}

export function homeRankOf(color: Color): number {
  return color === "w" ? 0 : 7;
}

/** The file `color`'s king stands on, if it is on its own back rank. */
function kingFileOnHomeRank(board: Board, color: Color): number | null {
  const king: Piece = color === "w" ? "K" : "k";
  const rank = homeRankOf(color);

  for (let file = 0; file < 8; file += 1) {
    if (pieceAt(board, squareAt(file, rank)) === king) {
      return file;
    }
  }

  return null;
}

/** The files `color`'s rooks stand on, on its own back rank, ascending. */
function rookFilesOnHomeRank(board: Board, color: Color): number[] {
  const rook: Piece = color === "w" ? "R" : "r";
  const rank = homeRankOf(color);
  const files: number[] = [];

  for (let file = 0; file < 8; file += 1) {
    if (pieceAt(board, squareAt(file, rank)) === rook) {
      files.push(file);
    }
  }

  return files;
}

/**
 * Read the castling field of a FEN into rights and the files they castle from.
 *
 * Two spellings are accepted, and the difference is only in how the rook is
 * named. `KQkq` is the ordinary one, where the rook is "the outermost one on
 * that side of the king" — which is the a- and h-rooks in a normal game and
 * still perfectly well defined in a shuffled one. Shredder-FEN instead names
 * the rook's file outright (`HAha`), which is what this writes back out for a
 * shuffled position, since `KQkq` there would be read differently by anything
 * that assumed a normal array.
 *
 * A flag whose rook cannot be located falls back to the standard file rather
 * than being dropped. That keeps a hand-written FEN round-tripping through
 * `toFen` unchanged, and costs nothing: `addCastlingMoves` checks that the king
 * and rook are actually on those squares before it offers the move.
 */
function readCastlingField(
  board: Board,
  field: string,
): { rights: CastlingRights; files: CastlingSetup } {
  const rights = noCastlingRights();
  const files = standardCastlingSetup();

  if (field === "-") {
    return { rights, files };
  }

  for (const color of ["w", "b"] as const) {
    const white = color === "w";
    const kingFile = kingFileOnHomeRank(board, color);
    const rooks = rookFilesOnHomeRank(board, color);
    const side = files[color];

    if (kingFile !== null) {
      side.king = kingFile;
    }

    const outermost = (kingSide: boolean): number | null => {
      if (kingFile === null) {
        return null;
      }
      const candidates = rooks.filter((file) =>
        kingSide ? file > kingFile : file < kingFile,
      );
      if (candidates.length === 0) {
        return null;
      }
      return kingSide ? candidates[candidates.length - 1]! : candidates[0]!;
    };

    for (const char of field) {
      const isOurs = white
        ? char === char.toUpperCase()
        : char === char.toLowerCase();
      if (!isOurs) {
        continue;
      }

      const upper = char.toUpperCase();

      if (upper === "K") {
        rights[white ? "whiteKingSide" : "blackKingSide"] = true;
        side.kingRook = outermost(true) ?? STANDARD_CASTLING_FILES.kingRook;
        continue;
      }

      if (upper === "Q") {
        rights[white ? "whiteQueenSide" : "blackQueenSide"] = true;
        side.queenRook = outermost(false) ?? STANDARD_CASTLING_FILES.queenRook;
        continue;
      }

      // Shredder-FEN: the letter is the rook's file, and which side it is
      // depends only on whether it stands right or left of the king.
      const rookFile = FILES.indexOf(char.toLowerCase());
      if (rookFile < 0) {
        continue;
      }

      // With no king on the back rank there is no "left" or "right" to sort it
      // into, and the flag is unusable either way.
      if (kingFile === null) {
        continue;
      }

      if (rookFile > kingFile) {
        rights[white ? "whiteKingSide" : "blackKingSide"] = true;
        side.kingRook = rookFile;
      } else if (rookFile < kingFile) {
        rights[white ? "whiteQueenSide" : "blackQueenSide"] = true;
        side.queenRook = rookFile;
      }
    }
  }

  return { rights, files };
}

/** The castling field of a FEN, `KQkq` or Shredder-FEN's file letters. */
function writeCastlingField(position: Position): string {
  const standard = isStandardCastlingSetup(position.castlingFiles);

  const letters = CASTLING_ORDER.filter(([key]) => position.castling[key]).map(
    ([key, flag]) => {
      if (standard) {
        return flag;
      }

      const white = key.startsWith("white");
      const files = position.castlingFiles[white ? "w" : "b"];
      const file = key.endsWith("KingSide") ? files.kingRook : files.queenRook;
      const letter = FILES[file] ?? "";

      return white ? letter.toUpperCase() : letter;
    },
  );

  return letters.join("") || "-";
}

export function parseFen(fen: string): Position {
  const parts = fen.trim().split(/\s+/);
  const [placement, turn, castling, enPassant, halfmove, fullmove] = parts;

  if (!placement || !turn || !castling || !enPassant) {
    throw new Error(`Invalid FEN: "${fen}"`);
  }

  const board = emptyBoard();
  const ranks = placement.split("/");
  if (ranks.length !== 8) {
    throw new Error(`Invalid FEN: expected 8 ranks, got ${ranks.length}`);
  }

  ranks.forEach((rank, rankIndex) => {
    let x = 0;
    for (const char of rank) {
      if (/[1-8]/.test(char)) {
        x += Number(char);
        continue;
      }

      if (!/[pnbrqkPNBRQK]/.test(char)) {
        throw new Error(`Invalid FEN: unexpected piece "${char}"`);
      }

      if (x > 7) {
        throw new Error(`Invalid FEN: rank "${rank}" overflows`);
      }

      board[rankIndex * 8 + x] = char as Piece;
      x += 1;
    }

    if (x !== 8) {
      throw new Error(`Invalid FEN: rank "${rank}" has ${x} squares`);
    }
  });

  if (turn !== "w" && turn !== "b") {
    throw new Error(`Invalid FEN: bad side to move "${turn}"`);
  }

  const { rights, files } = readCastlingField(board, castling);

  const enPassantSquare = enPassant === "-" ? null : fromAlgebraic(enPassant);
  if (enPassant !== "-" && enPassantSquare === null) {
    throw new Error(`Invalid FEN: bad en passant square "${enPassant}"`);
  }

  // Move generation trusts `enPassant` blindly — it emits the capture whenever
  // a pawn can reach the square, and applyMove then clears the square behind it
  // as "the captured pawn". A FEN whose en passant square is inconsistent with
  // the board (wrong rank, or no enemy pawn that just double-pushed to sit
  // behind it) would therefore fabricate a capture that deletes an arbitrary
  // piece — including the mover's own. Reject it here so only a real, capturable
  // en passant square survives parsing.
  if (enPassantSquare !== null) {
    const epRank = rankOf(enPassantSquare); // 0-based: rank 6 -> 5, rank 3 -> 2
    const expectedRank = turn === "w" ? 5 : 2;
    const pawnRank = turn === "w" ? 4 : 3;
    const enemyPawn: Piece = turn === "w" ? "p" : "P";
    const pawnSquare = squareAt(fileOf(enPassantSquare), pawnRank);

    if (
      epRank !== expectedRank ||
      pieceAt(board, enPassantSquare) !== EMPTY ||
      pieceAt(board, pawnSquare) !== enemyPawn
    ) {
      throw new Error(
        `Invalid FEN: en passant square "${enPassant}" has no pawn to capture`,
      );
    }
  }

  const halfmoveClock = halfmove ? Number(halfmove) : 0;
  if (!Number.isInteger(halfmoveClock) || halfmoveClock < 0) {
    throw new Error(`Invalid FEN: bad halfmove clock "${halfmove}"`);
  }

  const fullmoveNumber = fullmove ? Number(fullmove) : 1;
  if (!Number.isInteger(fullmoveNumber) || fullmoveNumber < 1) {
    throw new Error(`Invalid FEN: bad fullmove number "${fullmove}"`);
  }

  return {
    board,
    turn,
    castling: rights,
    castlingFiles: files,
    enPassant: enPassantSquare,
    halfmoveClock,
    fullmoveNumber,
  };
}

export function toFen(position: Position): string {
  const rows: string[] = [];
  for (let rank = 0; rank < 8; rank++) {
    let row = "";
    let gap = 0;

    for (let x = 0; x < 8; x++) {
      const piece = pieceAt(position.board, rank * 8 + x);
      if (piece === EMPTY) {
        gap += 1;
        continue;
      }

      if (gap > 0) {
        row += String(gap);
        gap = 0;
      }
      row += piece;
    }

    if (gap > 0) {
      row += String(gap);
    }
    rows.push(row);
  }

  const castling = writeCastlingField(position);

  const enPassant =
    position.enPassant === null ? "-" : toAlgebraic(position.enPassant);

  return [
    rows.join("/"),
    position.turn,
    castling,
    enPassant,
    position.halfmoveClock,
    position.fullmoveNumber,
  ].join(" ");
}

/**
 * Whether the position's en passant square can actually be captured — i.e. a
 * pawn of the side to move sits beside the just-pushed enemy pawn. `applyMove`
 * records an en passant square after *every* double push, capturable or not, so
 * this is what separates a real en passant possibility from a phantom one.
 */
export function enPassantIsCapturable(position: Position): boolean {
  const ep = position.enPassant;
  if (ep === null) {
    return false;
  }

  // The capturing pawn shares a rank with the pushed pawn (one rank below the
  // en passant square, from the mover's side) and stands on an adjacent file.
  const epFile = fileOf(ep);
  const capturerRank = position.turn === "w" ? 4 : 3;
  const capturer: Piece = position.turn === "w" ? "P" : "p";

  for (const file of [epFile - 1, epFile + 1]) {
    if (
      isOnBoard(file, capturerRank) &&
      pieceAt(position.board, squareAt(file, capturerRank)) === capturer
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Identifies a position for threefold-repetition purposes: the pieces, the side
 * to move, castling rights, and the en passant square — but not the clocks.
 */
export function repetitionKey(position: Position): string {
  const fields = toFen(position).split(" ").slice(0, 4);

  // FIDE Art. 9.2 counts two positions as the same unless the en passant
  // *possibility* differs. A double push that no enemy pawn can answer records
  // a square all the same, so an otherwise-identical position reached later
  // with no en passant square keys differently — and a legitimate threefold
  // goes uncounted. Normalize a phantom square away so only a real, capturable
  // en passant distinguishes positions.
  if (position.enPassant !== null && !enPassantIsCapturable(position)) {
    fields[3] = "-";
  }

  return fields.join(" ");
}
