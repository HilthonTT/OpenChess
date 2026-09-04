import { evaluate } from "./evaluate";
import {
  applyMove,
  findMove,
  generateLegalMoves,
  isInCheck,
  isInsufficientMaterial,
} from "./moves";
import { chooseBookMove } from "./opening-book";
import {
  personalityFor,
  searchLimitsFor,
  type Difficulty,
  type Personality,
  type PersonalityId,
} from "./personality";
import { toSan } from "./san";
import { MATE_SCORE, MATE_THRESHOLD, search } from "./search";
import type { Color, Move, Position } from "./types";

export type { Difficulty, Personality, PersonalityId };
export {
  DEFAULT_PERSONALITY,
  DIFFICULTIES,
  PERSONALITIES,
  PERSONALITY_LIST,
  PERSONALITY_ORDER,
  isPersonalityId,
  personalitiesAtTier,
  personalityFor,
  searchLimitsFor,
} from "./personality";

export type FindMoveOptions = {
  book?: boolean;
  random?: () => number;
};

export function findBestMove(
  position: Position,
  who: PersonalityId | Personality,
  history: readonly Position[] = [],
  options: FindMoveOptions = {},
): Move | null {
  const moves = generateLegalMoves(position);
  if (moves.length === 0) {
    return null;
  }

  const personality = typeof who === "string" ? personalityFor(who) : who;
  const random = options.random ?? Math.random;

  if (personality.slipChance > 0 && random() < personality.slipChance) {
    return moves[Math.floor(random() * moves.length)] ?? null;
  }

  if (options.book ?? true) {
    const fromBook = chooseBookMove(position, {
      random,
      style: personality.opening,
    });
    if (fromBook) {
      return (
        findMove(
          moves,
          fromBook.from,
          fromBook.to,
          fromBook.promotion ?? undefined,
        ) ?? fromBook
      );
    }
  }

  return search(position, searchLimitsFor(personality), history).bestMove;
}

export const ANALYSIS_DEPTH = 8;

const ANALYSIS_NODES = 8_000;

export type MoveQuality =
  | "best"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export type Analysis = {
  scoreCp: number;
  mateIn: number | null;
  bestMove: Move | null;
  line: Move[];
  depth: number;
};

const SETTLED: Pick<Analysis, "line" | "depth"> = { line: [], depth: 0 };

export function evaluatePosition(position: Position): number {
  const score = evaluate(position);
  return position.turn === "w" ? score : -score;
}

export function analyzePosition(
  position: Position,
  depth: number = ANALYSIS_DEPTH,
  nodes: number = ANALYSIS_NODES,
): Analysis {
  const moves = generateLegalMoves(position);

  if (moves.length === 0) {
    if (isInCheck(position, position.turn)) {
      const whiteMated = position.turn === "w";
      return {
        scoreCp: whiteMated ? -MATE_SCORE : MATE_SCORE,
        mateIn: 0,
        bestMove: null,
        ...SETTLED,
      };
    }
    return { scoreCp: 0, mateIn: null, bestMove: null, ...SETTLED };
  }

  if (position.halfmoveClock >= 100 || isInsufficientMaterial(position)) {
    return { scoreCp: 0, mateIn: null, bestMove: null, ...SETTLED };
  }

  const result = search(position, { depth, nodes });

  const whiteScore = position.turn === "w" ? result.score : -result.score;

  let mateIn: number | null = null;
  if (Math.abs(result.score) >= MATE_THRESHOLD) {
    const plies = MATE_SCORE - Math.abs(result.score);
    const movesToMate = Math.max(1, Math.ceil(plies / 2));
    const whiteMating = result.score > 0 === (position.turn === "w");
    mateIn = whiteMating ? movesToMate : -movesToMate;
  }

  return {
    scoreCp: whiteScore,
    mateIn,
    bestMove: result.bestMove,
    line: result.pv,
    depth: result.depth,
  };
}

export function lineToSan(position: Position, line: readonly Move[]): string[] {
  const sans: string[] = [];
  let current = position;

  for (const move of line) {
    const legal = generateLegalMoves(current);
    if (!findMove(legal, move.from, move.to, move.promotion ?? undefined)) {
      break;
    }
    sans.push(toSan(current, move, legal));
    current = applyMove(current, move);
  }

  return sans;
}

export function formatLine(position: Position, line: readonly Move[]): string {
  const sans = lineToSan(position, line);
  if (sans.length === 0) {
    return "";
  }

  const parts: string[] = [];
  let number = position.fullmoveNumber;
  let turn = position.turn;

  for (const [index, san] of sans.entries()) {
    if (turn === "w") {
      parts.push(`${number}. ${san}`);
    } else {
      parts.push(index === 0 ? `${number}… ${san}` : san);
      number += 1;
    }
    turn = turn === "w" ? "b" : "w";
  }

  return parts.join(" ");
}

export function centipawnLoss(
  mover: Color,
  whiteEvalBefore: number,
  whiteEvalAfter: number,
): number {
  const delta =
    mover === "w"
      ? whiteEvalBefore - whiteEvalAfter
      : whiteEvalAfter - whiteEvalBefore;
  return Math.max(0, delta);
}

export function classifyMove(centipawnLoss: number): MoveQuality {
  if (centipawnLoss <= 20) {
    return "best";
  }
  if (centipawnLoss <= 60) {
    return "good";
  }
  if (centipawnLoss <= 120) {
    return "inaccuracy";
  }
  if (centipawnLoss <= 250) {
    return "mistake";
  }
  return "blunder";
}
