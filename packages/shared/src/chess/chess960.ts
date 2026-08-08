import { emptyBoard, homeRankOf, squareAt, toFen } from "./board";
import type { CastlingSetup, PieceType, Position } from "./types";

/**
 * Chess960 starting arrays.
 *
 * The pieces on the back rank are shuffled; the pawns, the rules, and where
 * castling *ends* are not. Two constraints survive the shuffle and are the only
 * reason a shuffled array still plays like chess: the bishops sit on opposite
 * colours, and the king stands somewhere between the two rooks — which is what
 * leaves both castling moves meaningful.
 *
 * Arrays are numbered 0–959 by Scharnagl's scheme, the one every engine and
 * database uses, so a position number here names the same array everywhere else.
 * #518 is the ordinary game, which is worth knowing for more than trivia: it is
 * what lets the same code path serve both variants, and what the test pins.
 */

export const CHESS960_POSITIONS = 960;

/** The number of the standard array, `RNBQKBNR`. */
export const STANDARD_CHESS960_INDEX = 518;

/**
 * The ten arrangements of the two knights, two rooks and king that keep the
 * king between the rooks, in Scharnagl's order. Everything else in the numbering
 * is positional arithmetic; this table is the part that has to be written down.
 */
const KNIGHT_ROOK_KING: readonly string[] = [
  "NNRKR",
  "NRNKR",
  "NRKNR",
  "NRKRN",
  "RNNKR",
  "RNKNR",
  "RNKRN",
  "RKNNR",
  "RKNRN",
  "RKRNN",
];

/** Whether `index` names a real array. */
export function isChess960Index(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CHESS960_POSITIONS;
}

/**
 * The back rank of array `index`, as piece kinds from the a-file to the h-file.
 *
 * The numbering is read off in the order the constraints bite: the two bishops
 * first, since their squares are fixed outright by the low digits; then the
 * queen, placed by counting empty files rather than by naming one, which is
 * what keeps every number legal; and finally the five that are left, which the
 * table above arranges.
 */
export function chess960BackRank(index: number): PieceType[] {
  if (!isChess960Index(index)) {
    throw new Error(
      `Chess960 position must be 0–${CHESS960_POSITIONS - 1}, got ${index}`,
    );
  }

  const rank: Array<PieceType | null> = Array<PieceType | null>(8).fill(null);

  // The light-squared bishop goes on b, d, f or h; the dark-squared one on
  // a, c, e or g. Opposite colours by construction rather than by a check.
  const lightBishop = index % 4;
  const afterLight = Math.floor(index / 4);
  rank[lightBishop * 2 + 1] = "b";

  const darkBishop = afterLight % 4;
  const afterDark = Math.floor(afterLight / 4);
  rank[darkBishop * 2] = "b";

  // The queen takes the nth still-empty file, so every one of the six values
  // names a distinct legal square whatever the bishops did.
  const queen = afterDark % 6;
  const afterQueen = Math.floor(afterDark / 6);

  let remaining = queen;
  for (let file = 0; file < 8; file += 1) {
    if (rank[file] !== null) {
      continue;
    }
    if (remaining === 0) {
      rank[file] = "q";
      break;
    }
    remaining -= 1;
  }

  const pattern = KNIGHT_ROOK_KING[afterQueen]!;
  let next = 0;
  for (let file = 0; file < 8; file += 1) {
    if (rank[file] !== null) {
      continue;
    }
    rank[file] = pattern[next]!.toLowerCase() as PieceType;
    next += 1;
  }

  return rank as PieceType[];
}

/** Where the king and rooks of `backRank` stand, which is what castling needs. */
export function castlingFilesFor(
  backRank: readonly PieceType[],
): CastlingSetup {
  const king = backRank.indexOf("k");
  const queenRook = backRank.indexOf("r");
  const kingRook = backRank.lastIndexOf("r");

  const files = { king, queenRook, kingRook };
  return { w: { ...files }, b: { ...files } };
}

/** The opening position of array `index`, as a FEN. */
export function chess960Fen(index: number): string {
  const backRank = chess960BackRank(index);
  const board = emptyBoard();

  for (const color of ["w", "b"] as const) {
    const white = color === "w";
    const home = homeRankOf(color);
    const pawnRank = white ? 1 : 6;

    for (let file = 0; file < 8; file += 1) {
      const piece = backRank[file]!;
      board[squareAt(file, home)] = white
        ? (piece.toUpperCase() as never)
        : piece;
      board[squareAt(file, pawnRank)] = white ? "P" : "p";
    }
  }

  const position: Position = {
    board,
    turn: "w",
    castling: {
      whiteKingSide: true,
      whiteQueenSide: true,
      blackKingSide: true,
      blackQueenSide: true,
    },
    castlingFiles: castlingFilesFor(backRank),
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
  };

  // Written through `toFen` rather than assembled here, so the castling field
  // is spelled by the one function that knows how — and so #518 comes back as
  // the ordinary `KQkq` starting FEN, byte for byte.
  return toFen(position);
}

/** A random array. `random` is injectable so a test can pin the draw. */
export function randomChess960Index(
  random: () => number = Math.random,
): number {
  return Math.floor(random() * CHESS960_POSITIONS);
}

/** A random opening position, as a FEN. */
export function randomChess960Fen(random: () => number = Math.random): string {
  return chess960Fen(randomChess960Index(random));
}
