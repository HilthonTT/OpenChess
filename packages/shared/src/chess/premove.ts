import {
  fileOf,
  homeRankOf,
  isOnBoard,
  isPiece,
  isStandardCastlingFiles,
  pieceAt,
  pieceColor,
  rankOf,
  squareAt,
  toAlgebraic,
} from "./board";
import { findLegalMove } from "./game";
import type { Game } from "./game";
import {
  BISHOP_DIRECTIONS,
  castlingDestinations,
  castlingRookSquare,
  KING_DELTAS,
  KNIGHT_DELTAS,
  ROOK_DIRECTIONS,
} from "./moves";
import type {
  CastleSide,
  CastlingRights,
  Color,
  Move,
  Piece,
  Position,
  PromotionPiece,
} from "./types";

export type Premove = {
  from: number;
  to: number;
  promotion: PromotionPiece | null;
};

const PROMOTION_CHOICES: readonly PromotionPiece[] = ["q", "r", "b", "n"];

const CASTLE_SIDES: readonly CastleSide[] = ["king", "queen"];

const PAWN_RANKS: Record<Color, { start: number; last: number; dir: number }> =
  {
    w: { start: 1, last: 7, dir: 1 },
    b: { start: 6, last: 0, dir: -1 },
  };

function hasCastlingRight(
  rights: CastlingRights,
  color: Color,
  side: CastleSide,
): boolean {
  if (color === "w") {
    return side === "king" ? rights.whiteKingSide : rights.whiteQueenSide;
  }
  return side === "king" ? rights.blackKingSide : rights.blackQueenSide;
}

function candidate(
  position: Position,
  from: number,
  to: number,
  piece: Piece,
  promotion: PromotionPiece | null = null,
  isCastle: CastleSide | null = null,
): Move {
  const occupant = pieceAt(position.board, to);

  return {
    from,
    to,
    piece,
    captured:
      isPiece(occupant) && pieceColor(occupant) !== pieceColor(piece)
        ? occupant
        : null,
    promotion,
    isEnPassant: false,
    isCastle,
    isDoublePawnPush: false,
  };
}

function generate(position: Position, from: number, piece: Piece): Move[] {
  const color = pieceColor(piece);
  const out: Move[] = [];
  const x = fileOf(from);
  const y = rankOf(from);

  const step = (dx: number, dy: number) => {
    if (isOnBoard(x + dx, y + dy)) {
      out.push(candidate(position, from, squareAt(x + dx, y + dy), piece));
    }
  };

  const ray = (dx: number, dy: number) => {
    let nx = x + dx;
    let ny = y + dy;

    while (isOnBoard(nx, ny)) {
      out.push(candidate(position, from, squareAt(nx, ny), piece));
      nx += dx;
      ny += dy;
    }
  };

  switch (piece.toLowerCase()) {
    case "p": {
      const { start, last, dir } = PAWN_RANKS[color];

      const pawn = (nx: number, ny: number) => {
        if (!isOnBoard(nx, ny)) {
          return;
        }

        const to = squareAt(nx, ny);

        if (ny !== last) {
          out.push(candidate(position, from, to, piece));
          return;
        }

        for (const choice of PROMOTION_CHOICES) {
          out.push(candidate(position, from, to, piece, choice));
        }
      };

      pawn(x, y + dir);
      if (y === start) {
        pawn(x, y + dir * 2);
      }
      pawn(x - 1, y + dir);
      pawn(x + 1, y + dir);
      break;
    }
    case "n":
      for (const [dx, dy] of KNIGHT_DELTAS) {
        step(dx, dy);
      }
      break;
    case "b":
      for (const [dx, dy] of BISHOP_DIRECTIONS) {
        ray(dx, dy);
      }
      break;
    case "r":
      for (const [dx, dy] of ROOK_DIRECTIONS) {
        ray(dx, dy);
      }
      break;
    case "q":
      for (const [dx, dy] of [...ROOK_DIRECTIONS, ...BISHOP_DIRECTIONS]) {
        ray(dx, dy);
      }
      break;
    case "k": {
      for (const [dx, dy] of KING_DELTAS) {
        step(dx, dy);
      }

      if (y !== homeRankOf(color)) {
        break;
      }

      const standard = isStandardCastlingFiles(position.castlingFiles[color]);

      for (const side of CASTLE_SIDES) {
        if (!hasCastlingRight(position.castling, color, side)) {
          continue;
        }

        const to = standard
          ? castlingDestinations(color, side).kingTo
          : castlingRookSquare(position, color, side);

        out.push(candidate(position, from, to, piece, null, side));
      }
      break;
    }
  }

  return out.filter((move) => move.to !== from);
}

export function premoveTargets(
  position: Position,
  from: number,
  color: Color,
): Move[] {
  const piece = pieceAt(position.board, from);

  if (!isPiece(piece) || pieceColor(piece) !== color) {
    return [];
  }

  return generate(position, from, piece);
}

export function premoveNeedsPromotion(
  position: Position,
  from: number,
  to: number,
  color: Color,
): boolean {
  return premoveTargets(position, from, color).some(
    (move) => move.to === to && move.promotion !== null,
  );
}

export function resolvePremove(game: Game, premove: Premove): Move | undefined {
  return findLegalMove(
    game,
    premove.from,
    premove.to,
    premove.promotion ?? undefined,
  );
}

export function describePremove(premove: Premove): string {
  return `${toAlgebraic(premove.from)}${toAlgebraic(premove.to)}${premove.promotion ?? ""}`;
}
