import { centipawnLoss, classifyMove, type MoveQuality } from "./ai";
import type { Color } from "./types";

/**
 * The game report: what the per-move verdicts add up to over a whole game.
 *
 * `ai.ts` scores one move at a time — how much it gave away, and what to call
 * that. This turns a game's worth of those into the two numbers a review
 * actually opens with: how accurately each side played, and where it went
 * wrong.
 */

/**
 * Evaluations past this are the same story — winning — and treating the
 * difference as loss would brand every simplification in a won game a blunder.
 * The same ceiling the eval bar draws on.
 */
export const EVAL_CLAMP = 1000;

export function clampEval(centipawns: number): number {
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, centipawns));
}

/** One move, with the evaluation either side of it. All scores white's POV. */
export type AnalyzedPly = {
  mover: Color;
  san: string;
  /** White-POV centipawns for the position the mover faced. */
  before: number;
  /** White-POV centipawns for the position they left behind. */
  after: number;
  /**
   * A forced mate was in view on one side of the move or the other. The move
   * is still scored, but its centipawn figure is not a real material count and
   * is withheld from the display.
   */
  mateInvolved: boolean;
};

export type PlyReport = {
  /** 1-based: `ply` 1 is the first move of the game. */
  ply: number;
  mover: Color;
  san: string;
  /** Centipawns given away, on the clamped axis. Never negative. */
  loss: number;
  quality: MoveQuality;
  /** How good the move was on its own, 0–100. */
  accuracy: number;
  /** False when a mate score fed the figure, so `loss` is not a material count. */
  lossIsExact: boolean;
};

export type SideReport = {
  /** Mean per-move accuracy, 0–100. 100 for a side that never moved. */
  accuracy: number;
  /** Average centipawn loss — the traditional figure, lower is better. */
  averageLoss: number;
  moves: number;
  counts: Record<MoveQuality, number>;
};

export type GameReport = {
  white: SideReport;
  black: SideReport;
  /** Every move, in order. */
  plies: PlyReport[];
};

/**
 * A centipawn evaluation as a winning chance, 0–100, from white's point of
 * view. The logistic constant is the one Lichess fits against its own game
 * database; the shape is what matters — a pawn is worth far more when the game
 * is level than when one side is already three pieces up, and accuracy scored
 * on raw centipawns would say the opposite.
 *
 * @see https://lichess.org/page/accuracy
 */
export function winningChance(centipawns: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1);
}

/**
 * How good one move was, 0–100, given how much winning chance it shed. The
 * curve is calibrated so a move that changes nothing scores ~100 and one that
 * throws away half the game scores near zero.
 */
export function moveAccuracy(winPercentLost: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * winPercentLost) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

const EMPTY_COUNTS = (): Record<MoveQuality, number> => ({
  best: 0,
  good: 0,
  inaccuracy: 0,
  mistake: 0,
  blunder: 0,
});

function summarize(plies: PlyReport[]): SideReport {
  const counts = EMPTY_COUNTS();
  let totalLoss = 0;
  let totalAccuracy = 0;

  for (const ply of plies) {
    counts[ply.quality] += 1;
    totalLoss += ply.loss;
    totalAccuracy += ply.accuracy;
  }

  // A side with no moves has given nothing away. Reporting 100% rather than 0
  // keeps a one-move game from reading as a catastrophe for whoever was
  // never on the move.
  if (plies.length === 0) {
    return { accuracy: 100, averageLoss: 0, moves: 0, counts };
  }

  return {
    accuracy: totalAccuracy / plies.length,
    averageLoss: totalLoss / plies.length,
    moves: plies.length,
    counts,
  };
}

/**
 * Score a whole game.
 *
 * Every figure is derived from the evaluations handed in, so a caller that
 * searched deeper gets a sharper report from the same code. Both the
 * centipawn and the winning-chance axes are clamped first: past a certain
 * point the search is only telling us the game is over, and letting a
 * +40-pawn position swing the arithmetic would make accuracy a measure of how
 * long the winner took to finish.
 */
export function buildGameReport(plies: AnalyzedPly[]): GameReport {
  const reports: PlyReport[] = plies.map((ply, index) => {
    const before = clampEval(ply.before);
    const after = clampEval(ply.after);

    const loss = centipawnLoss(ply.mover, before, after);

    // Winning chance is a white-POV axis too, so the mover's own loss is the
    // drop for white and the rise for black.
    const chanceBefore = winningChance(before);
    const chanceAfter = winningChance(after);
    const chanceLost = Math.max(
      0,
      ply.mover === "w"
        ? chanceBefore - chanceAfter
        : chanceAfter - chanceBefore,
    );

    return {
      ply: index + 1,
      mover: ply.mover,
      san: ply.san,
      loss,
      quality: classifyMove(loss),
      accuracy: moveAccuracy(chanceLost),
      lossIsExact: !ply.mateInvolved,
    };
  });

  return {
    white: summarize(reports.filter((ply) => ply.mover === "w")),
    black: summarize(reports.filter((ply) => ply.mover === "b")),
    plies: reports,
  };
}

/** Anything worse than "good" — what a review jumps between. */
export function mistakes(
  report: GameReport,
  options: { side?: Color } = {},
): PlyReport[] {
  return report.plies.filter(
    (ply) =>
      (options.side === undefined || ply.mover === options.side) &&
      (ply.quality === "inaccuracy" ||
        ply.quality === "mistake" ||
        ply.quality === "blunder"),
  );
}
