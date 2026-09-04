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

export function toAlgebraic(square: number): string {
  return `${FILES[fileOf(square)]}${rankOf(square) + 1}`;
}

export function pieceColor(piece: Piece): Color {
  return piece === piece.toUpperCase() ? "w" : "b";
}

export function isPiece(square: SquareContent): square is Piece {
  return square !== EMPTY;
}

export function isColor(square: SquareContent, color: Color): boolean {
  return isPiece(square) && pieceColor(square) === color;
}

export function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

export function toPiece(type: string, color: Color): Piece {
  return (color === "w" ? type.toUpperCase() : type.toLowerCase()) as Piece;
}

export function emptyBoard(): Board {
  return Array<SquareContent>(64).fill(EMPTY);
}

export function pieceAt(board: Board, square: number): SquareContent {
  return board[square] ?? EMPTY;
}

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

export function isStandardCastlingSetup(setup: CastlingSetup): boolean {
  return isStandardCastlingFiles(setup.w) && isStandardCastlingFiles(setup.b);
}

export function homeRankOf(color: Color): number {
  return color === "w" ? 0 : 7;
}

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

      const rookFile = FILES.indexOf(char.toLowerCase());
      if (rookFile < 0) {
        continue;
      }

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

  if (enPassantSquare !== null) {
    const epRank = rankOf(enPassantSquare);
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

export function enPassantIsCapturable(position: Position): boolean {
  const ep = position.enPassant;
  if (ep === null) {
    return false;
  }

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
