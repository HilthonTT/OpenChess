import {
  fileOf,
  isPiece,
  pieceAt,
  pieceColor,
  rankOf,
  squareAt,
} from "./board";
import type { Color, PieceType, Position } from "./types";

/**
 * Static evaluation: what a position is worth without searching it.
 *
 * Everything here is measured in centipawns and scored twice — once for a
 * middlegame and once for an endgame — then blended by how much material is
 * still on the board. The blend is the point. A king belongs behind its pawns
 * while the queens are on and in the middle of the board once they are off, and a
 * single table cannot say both; an engine holding only the middlegame view walks
 * its king to the corner in a king-and-pawn ending and never finds the win.
 */

/** Material in centipawns. Deliberately not `pieceValue`, which counts in pawns. */
const MATERIAL: Record<PieceType, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  // The king is never captured, so its material value would cancel out anyway.
  k: 0,
};

/**
 * Piece-square tables in centipawns, from white's point of view. The arrays are
 * laid out in board order (index 0 = a8), so a white piece reads its square
 * directly and a black piece reads the vertical mirror (`square ^ 56`).
 */
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

/**
 * The endgame view. Only the pawn and the king want anything different once the
 * queens come off — a pawn's whole value becomes how close it is to promoting,
 * and the king stops hiding and starts fighting — so the other four pieces keep
 * reading the middlegame table rather than carrying a near-identical copy.
 */
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

/**
 * How much of the middlegame each piece keeps on the board. Pawns count for
 * nothing: a position with every pawn and no pieces is an endgame, which is
 * exactly the position type the endgame tables exist for.
 */
const PHASE_WEIGHTS: Record<PieceType, number> = {
  p: 0,
  n: 1,
  b: 1,
  r: 2,
  q: 4,
  k: 0,
};

/** The weight of a full starting array: four minors, four rooks, two queens. */
const TOTAL_PHASE = 24;

/** A passed pawn's bonus by how far it has come, indexed by rank from its own side. */
const PASSED_PAWN_MIDGAME = [0, 5, 10, 20, 35, 60, 100, 0];
const PASSED_PAWN_ENDGAME = [0, 10, 25, 45, 80, 130, 190, 0];

const DOUBLED_PAWN_MIDGAME = -12;
const DOUBLED_PAWN_ENDGAME = -22;
const ISOLATED_PAWN_MIDGAME = -16;
const ISOLATED_PAWN_ENDGAME = -12;

/** Two bishops cover both square colours, which is worth more than either alone. */
const BISHOP_PAIR_MIDGAME = 30;
const BISHOP_PAIR_ENDGAME = 50;

const ROOK_OPEN_FILE = 22;
const ROOK_SEMI_OPEN_FILE = 11;

/** Per missing pawn in front of a castled king. Midgame only — see `kingShield`. */
const SHIELD_HOLE = -14;

/**
 * How far each square is from the middle of the board, in king moves. What a side
 * mating with pieces alone needs to know: the defending king has to be walked to
 * an edge, and preferably a corner, before any mate exists.
 */
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

/** The material lead at which a pawnless position is worth trying to mate in. */
const MATING_MATERIAL = 400;

const DRIVE_TO_EDGE = 12;
const DRIVE_KINGS_TOGETHER = 6;

/**
 * What one engine cares about relative to another.
 *
 * Every weight is a multiplier on the constants above, and the default is all
 * ones — which is to say the evaluation as it was before any of this existed.
 * They are what separates one bot from another: a `material` under 1 alongside
 * a `pieceSquares` over it produces an engine that will give up a pawn for
 * activity without being told what a gambit is, and the same trick in reverse
 * produces one that hoards.
 *
 * Only *ratios* matter. Scaling every weight by the same factor scales the
 * whole score and changes no decision, which is worth knowing when tuning one:
 * raising a term does nothing unless something else stays where it was.
 */
export type EvalWeights = {
  /** Raw piece values — how much the engine minds being down material. */
  material: number;
  /** The piece-square tables: how much it minds where its pieces stand. */
  pieceSquares: number;
  /** Doubled and isolated pawns. */
  pawnStructure: number;
  passedPawns: number;
  bishopPair: number;
  rookFiles: number;
  /** The pawn shield in front of a king that has castled. */
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

/**
 * Pawn structure, gathered in one pass so the scoring pass can ask about a file
 * without rescanning the board.
 *
 * These live at module scope and are reused: `evaluate` runs at every leaf of the
 * search — millions of times a move — and never recurses, so allocating six
 * arrays per call would be pure garbage for no benefit.
 */
const WHITE_PAWNS_ON_FILE = new Int8Array(8);
const BLACK_PAWNS_ON_FILE = new Int8Array(8);
/** The rank of white's least advanced pawn per file, or 8 for none. */
const WHITE_LOWEST_PAWN = new Int8Array(8);
/** The rank of black's least advanced pawn per file, or -1 for none. */
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

/**
 * Nothing of black's stands between this white pawn and the promotion square —
 * not on its file, and not on either neighbour, where a black pawn could capture
 * it on the way. Only the most advanced black pawn per file can matter, which is
 * why `gatherPawns` keeps just that one.
 */
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

/**
 * The holes in the pawns in front of a king, counted over its own file and the
 * two beside it, two ranks deep.
 *
 * Midgame only, and only for a king still on its first two ranks: once the
 * queens are off, a king walled in behind pawns is a liability rather than a
 * safe one, and that is what the endgame table already says.
 */
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

/**
 * Static evaluation in centipawns from the side-to-move's point of view, as
 * negamax expects.
 */
export function evaluate(
  position: Position,
  weights: EvalWeights = DEFAULT_EVAL_WEIGHTS,
): number {
  gatherPawns(position);

  let midgame = 0;
  let endgame = 0;
  let phase = 0;

  let whiteBishops = 0;
  let blackBishops = 0;

  // Kept for the mating drive below, which needs to know who is winning, whether
  // any pawn is left, and where the two kings are.
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
    // A black piece reads the vertical mirror of the white-POV table.
    const tableSquare = white ? square : square ^ 56;

    phase += PHASE_WEIGHTS[type];

    const material = MATERIAL[type];
    const scaled = material * weights.material;
    midgame +=
      sign *
      (scaled + MIDGAME_TABLES[type][tableSquare]! * weights.pieceSquares);
    endgame +=
      sign *
      (scaled + ENDGAME_TABLES[type][tableSquare]! * weights.pieceSquares);

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
          midgame += sign * DOUBLED_PAWN_MIDGAME * weights.pawnStructure;
          endgame += sign * DOUBLED_PAWN_ENDGAME * weights.pawnStructure;
        }

        if (isIsolated(onFile, file)) {
          midgame += sign * ISOLATED_PAWN_MIDGAME * weights.pawnStructure;
          endgame += sign * ISOLATED_PAWN_ENDGAME * weights.pawnStructure;
        }

        const passed = white
          ? whitePawnIsPassed(file, rank)
          : blackPawnIsPassed(file, rank);

        if (passed) {
          // How far the pawn has come, from its own side of the board.
          const advance = white ? rank : 7 - rank;
          midgame += sign * PASSED_PAWN_MIDGAME[advance]! * weights.passedPawns;
          endgame += sign * PASSED_PAWN_ENDGAME[advance]! * weights.passedPawns;
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
        // An open file is one with no pawns at all; a half-open file has none of
        // the rook's own, which is enough for it to bear down the board.
        const own = white ? WHITE_PAWNS_ON_FILE : BLACK_PAWNS_ON_FILE;
        const enemy = white ? BLACK_PAWNS_ON_FILE : WHITE_PAWNS_ON_FILE;

        if (own[file] === 0) {
          const bonus =
            (enemy[file] === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE) *
            weights.rookFiles;
          midgame += sign * bonus;
          endgame += sign * (bonus / 2);
        }
        break;
      }

      case "k":
        midgame +=
          sign *
          kingShield(position, square, white) *
          SHIELD_HOLE *
          weights.kingSafety;
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
    midgame += BISHOP_PAIR_MIDGAME * weights.bishopPair;
    endgame += BISHOP_PAIR_ENDGAME * weights.bishopPair;
  }
  if (blackBishops >= 2) {
    midgame -= BISHOP_PAIR_MIDGAME * weights.bishopPair;
    endgame -= BISHOP_PAIR_ENDGAME * weights.bishopPair;
  }

  // The mating drive. With pawns on the board a material lead plays itself — push
  // a pawn, promote it — but with pieces alone there is nothing to make progress
  // towards, and a material score alone is flat: every shuffle looks as good as
  // the last, and the engine draws a won game by the fifty-move rule.
  //
  // Two bishops against a bare king is the case that needs it. The mate exists
  // but is a dozen moves of technique away, further than any search here will
  // see, so the evaluation has to point the way: walk the defending king to an
  // edge, and bring your own king up to it.
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

      endgame += whiteIsWinning ? drive : -drive;
    }
  }

  // A position can hold more material than the starting array — promote three
  // queens and the weights run past 24 — so the blend is clamped rather than
  // allowed to extrapolate past the middlegame.
  const midgameWeight = Math.min(phase, TOTAL_PHASE);
  const blended =
    (midgame * midgameWeight + endgame * (TOTAL_PHASE - midgameWeight)) /
    TOTAL_PHASE;

  // Rounded on the magnitude rather than on the value. `Math.round` settles a tie
  // towards positive infinity, so a position landing on x.5 and its mirror image
  // landing on -x.5 would round to numbers a centipawn apart — a standing bias
  // towards one colour, small but real, in the one function that is supposed to
  // treat them alike.
  const score = blended < 0 ? -Math.round(-blended) : Math.round(blended);

  return position.turn === "w" ? score : -score;
}

/**
 * Whether `color` has anything but pawns left. Null-move pruning leans on this:
 * the trick assumes having to move is no worse than passing, and a king-and-pawn
 * ending is exactly where that assumption breaks.
 */
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
