import {
  fileOf,
  isPiece,
  pieceAt,
  pieceColor,
  rankOf,
  squareAt,
} from "./board";
import type { Color, PieceType, Position } from "./types";

const MATERIAL: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0,
};

const MIDGAME_TABLES: Record<PieceType, number[]> = {
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  r: [
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
  ],
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  q: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
};

const ENDGAME_TABLES: Record<PieceType, number[]> = {
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     90,  90,  90,  90,  90,  90,  90,  90,
     50,  50,  50,  50,  50,  50,  50,  50,
     30,  30,  30,  30,  30,  30,  30,  30,
     20,  20,  20,  20,  20,  20,  20,  20,
     10,  10,  10,  10,  10,  10,  10,  10,
     10,  10,  10,  10,  10,  10,  10,  10,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: MIDGAME_TABLES.n,
  b: MIDGAME_TABLES.b,
  r: MIDGAME_TABLES.r,
  q: MIDGAME_TABLES.q,
  // biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
  k: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10,   0,   0, -10, -20, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  30,  40,  40,  30, -10, -30,
    -30, -10,  20,  30,  30,  20, -10, -30,
    -30, -30,   0,   0,   0,   0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

const PHASE_WEIGHTS: Record<PieceType, number> = {
  p: 0,
  n: 1,
  b: 1,
  r: 2,
  q: 4,
  k: 0,
};

const TOTAL_PHASE = 24;

const PASSED_PAWN_MIDGAME = [0, 5, 10, 20, 35, 60, 100, 0];
const PASSED_PAWN_ENDGAME = [0, 10, 25, 45, 80, 130, 190, 0];

const DOUBLED_PAWN_MIDGAME = -12;
const DOUBLED_PAWN_ENDGAME = -22;
const ISOLATED_PAWN_MIDGAME = -16;
const ISOLATED_PAWN_ENDGAME = -12;

const BISHOP_PAIR_MIDGAME = 30;
const BISHOP_PAIR_ENDGAME = 50;

const ROOK_OPEN_FILE = 22;
const ROOK_SEMI_OPEN_FILE = 11;

const SHIELD_HOLE = -14;

// biome-ignore format: the 8x8 layout is the board itself; collapsing it hides the shape
const DISTANCE_FROM_CENTRE = [
  6, 5, 4, 3, 3, 4, 5, 6,
  5, 4, 3, 2, 2, 3, 4, 5,
  4, 3, 2, 1, 1, 2, 3, 4,
  3, 2, 1, 0, 0, 1, 2, 3,
  3, 2, 1, 0, 0, 1, 2, 3,
  4, 3, 2, 1, 1, 2, 3, 4,
  5, 4, 3, 2, 2, 3, 4, 5,
  6, 5, 4, 3, 3, 4, 5, 6,
];

const MATING_MATERIAL = 400;

const DRIVE_TO_EDGE = 12;
const DRIVE_KINGS_TOGETHER = 6;

export type EvalWeights = {
  material: number;
  pieceSquares: number;
  pawnStructure: number;
  passedPawns: number;
  bishopPair: number;
  rookFiles: number;
  kingSafety: number;
};

export const DEFAULT_EVAL_WEIGHTS: EvalWeights = Object.freeze({
  material: 1,
  pieceSquares: 1,
  pawnStructure: 1,
  passedPawns: 1,
  bishopPair: 1,
  rookFiles: 1,
  kingSafety: 1,
});

export type EvalTerm = keyof EvalWeights;

export const EVAL_TERMS: readonly EvalTerm[] = Object.freeze([
  "material",
  "pieceSquares",
  "pawnStructure",
  "passedPawns",
  "bishopPair",
  "rookFiles",
  "kingSafety",
]);

const MATERIAL_TERM = 0;
const PIECE_SQUARES_TERM = 1;
const PAWN_STRUCTURE_TERM = 2;
const PASSED_PAWNS_TERM = 3;
const BISHOP_PAIR_TERM = 4;
const ROOK_FILES_TERM = 5;
const KING_SAFETY_TERM = 6;
const FIXED_TERM = 7;

export const EVAL_FEATURE_COUNT = EVAL_TERMS.length + 1;

const MIDGAME_TERMS = new Float64Array(EVAL_FEATURE_COUNT);
const ENDGAME_TERMS = new Float64Array(EVAL_FEATURE_COUNT);

const WHITE_PAWNS_ON_FILE = new Int8Array(8);
const BLACK_PAWNS_ON_FILE = new Int8Array(8);

const WHITE_LOWEST_PAWN = new Int8Array(8);

const BLACK_HIGHEST_PAWN = new Int8Array(8);

function gatherPawns(position: Position): void {
  WHITE_PAWNS_ON_FILE.fill(0);
  BLACK_PAWNS_ON_FILE.fill(0);
  WHITE_LOWEST_PAWN.fill(8);
  BLACK_HIGHEST_PAWN.fill(-1);

  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (piece !== "P" && piece !== "p") {
      continue;
    }

    const file = fileOf(square);
    const rank = rankOf(square);

    if (piece === "P") {
      WHITE_PAWNS_ON_FILE[file] = WHITE_PAWNS_ON_FILE[file]! + 1;
      if (rank < WHITE_LOWEST_PAWN[file]!) {
        WHITE_LOWEST_PAWN[file] = rank;
      }
    } else {
      BLACK_PAWNS_ON_FILE[file] = BLACK_PAWNS_ON_FILE[file]! + 1;
      if (rank > BLACK_HIGHEST_PAWN[file]!) {
        BLACK_HIGHEST_PAWN[file] = rank;
      }
    }
  }
}

function whitePawnIsPassed(file: number, rank: number): boolean {
  for (let f = file - 1; f <= file + 1; f += 1) {
    if (f < 0 || f > 7) {
      continue;
    }
    if (BLACK_HIGHEST_PAWN[f]! > rank) {
      return false;
    }
  }
  return true;
}

function blackPawnIsPassed(file: number, rank: number): boolean {
  for (let f = file - 1; f <= file + 1; f += 1) {
    if (f < 0 || f > 7) {
      continue;
    }
    if (WHITE_LOWEST_PAWN[f]! < rank) {
      return false;
    }
  }
  return true;
}

function isIsolated(onFile: Int8Array, file: number): boolean {
  const left = file > 0 ? onFile[file - 1]! : 0;
  const right = file < 7 ? onFile[file + 1]! : 0;
  return left === 0 && right === 0;
}

function kingShield(
  position: Position,
  square: number,
  white: boolean,
): number {
  const rank = rankOf(square);
  const home = white ? rank <= 1 : rank >= 6;
  if (!home) {
    return 0;
  }

  const pawn = white ? "P" : "p";
  const forward = white ? 1 : -1;
  const file = fileOf(square);

  let holes = 0;
  for (let f = file - 1; f <= file + 1; f += 1) {
    if (f < 0 || f > 7) {
      continue;
    }

    const near = rank + forward;
    const far = rank + forward * 2;
    const hasNear =
      near >= 0 &&
      near <= 7 &&
      pieceAt(position.board, squareAt(f, near)) === pawn;
    const hasFar =
      far >= 0 &&
      far <= 7 &&
      pieceAt(position.board, squareAt(f, far)) === pawn;

    if (!hasNear && !hasFar) {
      holes += 1;
    }
  }

  return holes;
}

function gatherTerms(position: Position): number {
  gatherPawns(position);
  MIDGAME_TERMS.fill(0);
  ENDGAME_TERMS.fill(0);

  let phase = 0;

  let whiteBishops = 0;
  let blackBishops = 0;

  let whiteMaterial = 0;
  let blackMaterial = 0;
  let pawns = 0;
  let whiteKing = -1;
  let blackKing = -1;

  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (piece === undefined || !isPiece(piece)) {
      continue;
    }

    const type = piece.toLowerCase() as PieceType;
    const white = pieceColor(piece) === "w";
    const sign = white ? 1 : -1;
    const tableSquare = white ? square : square ^ 56;

    phase += PHASE_WEIGHTS[type];

    const material = MATERIAL[type];
    MIDGAME_TERMS[MATERIAL_TERM]! += sign * material;
    ENDGAME_TERMS[MATERIAL_TERM]! += sign * material;
    MIDGAME_TERMS[PIECE_SQUARES_TERM]! +=
      sign * MIDGAME_TABLES[type][tableSquare]!;
    ENDGAME_TERMS[PIECE_SQUARES_TERM]! +=
      sign * ENDGAME_TABLES[type][tableSquare]!;

    if (white) {
      whiteMaterial += material;
    } else {
      blackMaterial += material;
    }

    const file = fileOf(square);
    const rank = rankOf(square);

    switch (type) {
      case "p": {
        pawns += 1;
        const onFile = white ? WHITE_PAWNS_ON_FILE : BLACK_PAWNS_ON_FILE;

        if (onFile[file]! > 1) {
          MIDGAME_TERMS[PAWN_STRUCTURE_TERM]! += sign * DOUBLED_PAWN_MIDGAME;
          ENDGAME_TERMS[PAWN_STRUCTURE_TERM]! += sign * DOUBLED_PAWN_ENDGAME;
        }

        if (isIsolated(onFile, file)) {
          MIDGAME_TERMS[PAWN_STRUCTURE_TERM]! += sign * ISOLATED_PAWN_MIDGAME;
          ENDGAME_TERMS[PAWN_STRUCTURE_TERM]! += sign * ISOLATED_PAWN_ENDGAME;
        }

        const passed = white
          ? whitePawnIsPassed(file, rank)
          : blackPawnIsPassed(file, rank);

        if (passed) {
          const advance = white ? rank : 7 - rank;
          MIDGAME_TERMS[PASSED_PAWNS_TERM]! +=
            sign * PASSED_PAWN_MIDGAME[advance]!;
          ENDGAME_TERMS[PASSED_PAWNS_TERM]! +=
            sign * PASSED_PAWN_ENDGAME[advance]!;
        }
        break;
      }

      case "b":
        if (white) {
          whiteBishops += 1;
        } else {
          blackBishops += 1;
        }
        break;

      case "r": {
        const own = white ? WHITE_PAWNS_ON_FILE : BLACK_PAWNS_ON_FILE;
        const enemy = white ? BLACK_PAWNS_ON_FILE : WHITE_PAWNS_ON_FILE;

        if (own[file] === 0) {
          const bonus =
            enemy[file] === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE;
          MIDGAME_TERMS[ROOK_FILES_TERM]! += sign * bonus;
          ENDGAME_TERMS[ROOK_FILES_TERM]! += sign * (bonus / 2);
        }
        break;
      }

      case "k":
        MIDGAME_TERMS[KING_SAFETY_TERM]! +=
          sign * kingShield(position, square, white) * SHIELD_HOLE;
        if (white) {
          whiteKing = square;
        } else {
          blackKing = square;
        }
        break;

      default:
        break;
    }
  }

  if (whiteBishops >= 2) {
    MIDGAME_TERMS[BISHOP_PAIR_TERM]! += BISHOP_PAIR_MIDGAME;
    ENDGAME_TERMS[BISHOP_PAIR_TERM]! += BISHOP_PAIR_ENDGAME;
  }
  if (blackBishops >= 2) {
    MIDGAME_TERMS[BISHOP_PAIR_TERM]! -= BISHOP_PAIR_MIDGAME;
    ENDGAME_TERMS[BISHOP_PAIR_TERM]! -= BISHOP_PAIR_ENDGAME;
  }

  if (pawns === 0 && whiteKing >= 0 && blackKing >= 0) {
    const lead = whiteMaterial - blackMaterial;

    if (Math.abs(lead) >= MATING_MATERIAL) {
      const whiteIsWinning = lead > 0;
      const weakKing = whiteIsWinning ? blackKing : whiteKing;
      const strongKing = whiteIsWinning ? whiteKing : blackKing;

      const between =
        Math.abs(fileOf(strongKing) - fileOf(weakKing)) +
        Math.abs(rankOf(strongKing) - rankOf(weakKing));

      const drive =
        DISTANCE_FROM_CENTRE[weakKing]! * DRIVE_TO_EDGE +
        (14 - between) * DRIVE_KINGS_TOGETHER;

      ENDGAME_TERMS[FIXED_TERM]! += whiteIsWinning ? drive : -drive;
    }
  }

  return Math.min(phase, TOTAL_PHASE);
}

function weighted(terms: Float64Array, weights: EvalWeights): number {
  return (
    terms[MATERIAL_TERM]! * weights.material +
    terms[PIECE_SQUARES_TERM]! * weights.pieceSquares +
    terms[PAWN_STRUCTURE_TERM]! * weights.pawnStructure +
    terms[PASSED_PAWNS_TERM]! * weights.passedPawns +
    terms[BISHOP_PAIR_TERM]! * weights.bishopPair +
    terms[ROOK_FILES_TERM]! * weights.rookFiles +
    terms[KING_SAFETY_TERM]! * weights.kingSafety +
    terms[FIXED_TERM]!
  );
}

export function evaluate(
  position: Position,
  weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
): number {
  const midgameWeight = gatherTerms(position);

  const midgame = weighted(MIDGAME_TERMS, weights);
  const endgame = weighted(ENDGAME_TERMS, weights);
  const blended =
    (midgame * midgameWeight + endgame * (TOTAL_PHASE - midgameWeight)) /
    TOTAL_PHASE;

  const score = blended < 0 ? -Math.round(-blended) : Math.round(blended);

  return position.turn === "w" ? score : -score;
}

export function evaluationFeatures(
  position: Position,
  out: Float64Array = new Float64Array(EVAL_FEATURE_COUNT),
): Float64Array {
  const midgameWeight = gatherTerms(position);
  const endgameWeight = TOTAL_PHASE - midgameWeight;

  for (let index = 0; index < EVAL_FEATURE_COUNT; index += 1) {
    out[index] =
      (MIDGAME_TERMS[index]! * midgameWeight +
        ENDGAME_TERMS[index]! * endgameWeight) /
      TOTAL_PHASE;
  }

  return out;
}

export function hasNonPawnMaterial(position: Position, color: Color): boolean {
  for (let square = 0; square < 64; square += 1) {
    const piece = position.board[square];
    if (piece === undefined || !isPiece(piece)) {
      continue;
    }

    const type = piece.toLowerCase();
    if (type === "p" || type === "k") {
      continue;
    }
    if (pieceColor(piece) === color) {
      return true;
    }
  }

  return false;
}
