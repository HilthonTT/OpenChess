import { emptyBoard, homeRankOf, squareAt, toFen } from "./board";
import type { CastlingSetup, PieceType, Position } from "./types";

export const CHESS960_POSITIONS = 960;

export const STANDARD_CHESS960_INDEX = 518;

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

export function isChess960Index(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CHESS960_POSITIONS;
}

export function chess960BackRank(index: number): PieceType[] {
  if (!isChess960Index(index)) {
    throw new Error(
      `Chess960 position must be 0–${CHESS960_POSITIONS - 1}, got ${index}`,
    );
  }

  const rank: Array<PieceType | null> = Array<PieceType | null>(8).fill(null);

  const lightBishop = index % 4;
  const afterLight = Math.floor(index / 4);
  rank[lightBishop * 2 + 1] = "b";

  const darkBishop = afterLight % 4;
  const afterDark = Math.floor(afterLight / 4);
  rank[darkBishop * 2] = "b";

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

export function castlingFilesFor(
  backRank: readonly PieceType[],
): CastlingSetup {
  const king = backRank.indexOf("k");
  const queenRook = backRank.indexOf("r");
  const kingRook = backRank.lastIndexOf("r");

  const files = { king, queenRook, kingRook };
  return { w: { ...files }, b: { ...files } };
}

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

  return toFen(position);
}

export function randomChess960Index(
  random: () => number = Math.random,
): number {
  return Math.floor(random() * CHESS960_POSITIONS);
}

export function randomChess960Fen(random: () => number = Math.random): string {
  return chess960Fen(randomChess960Index(random));
}
