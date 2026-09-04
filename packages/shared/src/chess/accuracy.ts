import { centipawnLoss, classifyMove, type MoveQuality } from "./ai";
import type { Color } from "./types";

export const EVAL_CLAMP = 1000;

export function clampEval(centipawns: number): number {
  return Math.max(-EVAL_CLAMP, Math.min(EVAL_CLAMP, centipawns));
}

export type AnalyzedPly = {
  mover: Color;
  san: string;
  before: number;
  after: number;
  mateInvolved: boolean;
};

export type PlyReport = {
  ply: number;
  mover: Color;
  san: string;
  loss: number;
  quality: MoveQuality;
  accuracy: number;
  lossIsExact: boolean;
};

export type SideReport = {
  accuracy: number;
  averageLoss: number;
  moves: number;
  counts: Record<MoveQuality, number>;
};

export type GameReport = {
  white: SideReport;
  black: SideReport;
  plies: PlyReport[];
};

export function winningChance(centipawns: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * centipawns)) - 1);
}

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

export function buildGameReport(plies: AnalyzedPly[]): GameReport {
  const reports: PlyReport[] = plies.map((ply, index) => {
    const before = clampEval(ply.before);
    const after = clampEval(ply.after);

    const loss = centipawnLoss(ply.mover, before, after);

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
