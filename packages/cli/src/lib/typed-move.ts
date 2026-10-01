import { findLegalMove, findSanMove, fromAlgebraic } from "@openchess/shared";
import type { Game, PromotionPiece } from "@openchess/shared";

export type TypedMove = {
  from: number;
  to: number;
  promotion?: PromotionPiece;
};

export type TypedMoveResult =
  | { kind: "move"; move: TypedMove }
  | { kind: "error"; message: string };

export const TYPED_MOVE_EXAMPLE = "e4, Nf3, O-O or e2e4";

const COORDINATES = /^([a-h][1-8])[-x]?([a-h][1-8])=?([qrbn])?$/;

/**
 * Reads "e2e4", "e2-e4" or "e7e8q" as a from square, a to square and an
 * optional promotion. It says nothing about whether the move is legal.
 */
export function parseCoordinates(text: string): TypedMove | null {
  const match = COORDINATES.exec(text.trim().toLowerCase());
  if (!match) {
    return null;
  }

  const from = fromAlgebraic(match[1]!);
  const to = fromAlgebraic(match[2]!);
  if (from === null || to === null) {
    return null;
  }

  const promotion = match[3] as PromotionPiece | undefined;
  return promotion ? { from, to, promotion } : { from, to };
}

/**
 * Finds the legal move a player typed, in SAN or in coordinates. SAN is
 * forgiving about case, so "nf3", "o-o" and "e8=q" all work; a lowercase
 * "b" is tried as a pawn on the b-file before it is tried as a bishop.
 *
 * A coordinate move onto the last rank may leave the promotion out — the
 * caller then asks for it the same way the board does.
 */
export function resolveTypedMove(game: Game, text: string): TypedMoveResult {
  const typed = text.replace(/\s+/g, "");
  if (typed === "") {
    return {
      kind: "error",
      message: `Type a move, like ${TYPED_MOVE_EXAMPLE}`,
    };
  }

  const coordinates = parseCoordinates(typed);
  if (coordinates) {
    const move = findLegalMove(
      game,
      coordinates.from,
      coordinates.to,
      coordinates.promotion,
    );
    if (move) {
      return { kind: "move", move: coordinates };
    }
  }

  for (const san of sanSpellings(typed)) {
    const move = findSanMove(game, san);
    if (move) {
      return {
        kind: "move",
        move: move.promotion
          ? { from: move.from, to: move.to, promotion: move.promotion }
          : { from: move.from, to: move.to },
      };
    }
  }

  return { kind: "error", message: `“${typed}” isn't a legal move here` };
}

function sanSpellings(typed: string): string[] {
  if (/^[o0](-[o0]){1,2}[+#]?$/i.test(typed)) {
    return [typed.replace(/[o0]/gi, "O")];
  }

  const promoted = typed.replace(
    /([a-h][18])=?([qrbn])([+#]?)$/i,
    (_, square: string, piece: string, check: string) =>
      `${square.toLowerCase()}=${piece.toUpperCase()}${check}`,
  );

  const spellings = [promoted];
  const first = promoted[0]!;
  if ("kqrbn".includes(first)) {
    spellings.push(first.toUpperCase() + promoted.slice(1));
  }

  return spellings;
}
