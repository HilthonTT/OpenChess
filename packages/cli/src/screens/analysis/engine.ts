import { useEffect, useMemo, useState } from "react";
import {
  analyzePosition,
  buildGameReport,
  createGame,
  playSan,
} from "@openchess/shared";
import type {
  Analysis as PositionAnalysis,
  AnalyzedPly,
  Game,
  GameReport,
} from "@openchess/shared";

export function buildFrames(history: string[], startingFen: string): Game[] {
  const frames: Game[] = [createGame(startingFen)];
  let game = frames[0]!;
  for (const san of history) {
    game = playSan(game, san);
    frames.push(game);
  }
  return frames;
}

export function useGameAnalysis(frames: Game[]): {
  analyses: Array<PositionAnalysis | null>;
  done: number;
} {
  const [analyses, setAnalyses] = useState<Array<PositionAnalysis | null>>(() =>
    frames.map(() => null),
  );

  useEffect(() => {
    setAnalyses(frames.map(() => null));

    let cancelled = false;
    let next = 0;
    const BATCH = 1;

    const step = () => {
      if (cancelled) {
        return;
      }

      const batch: Array<{ index: number; analysis: PositionAnalysis }> = [];
      for (let n = 0; n < BATCH && next < frames.length; n += 1, next += 1) {
        batch.push({
          index: next,
          analysis: analyzePosition(frames[next]!.position),
        });
      }

      if (batch.length > 0) {
        setAnalyses((prev) => {
          const updated = prev.slice();
          for (const item of batch) {
            updated[item.index] = item.analysis;
          }
          return updated;
        });
      }

      if (next < frames.length) {
        setTimeout(step, 0);
      }
    };

    const timer = setTimeout(step, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [frames]);

  const done = analyses.filter((entry) => entry !== null).length;
  return { analyses, done };
}

export function useGameReport(
  frames: Game[],
  analyses: Array<PositionAnalysis | null>,
  history: string[],
): GameReport {
  return useMemo(() => {
    const plies: AnalyzedPly[] = [];

    for (let ply = 1; ply < frames.length; ply += 1) {
      const before = analyses[ply - 1];
      const after = analyses[ply];

      if (!before || !after) {
        break;
      }

      plies.push({
        mover: frames[ply - 1]!.position.turn,
        san: history[ply - 1] ?? "",
        before: before.scoreCp,
        after: after.scoreCp,
        mateInvolved: before.mateIn !== null || after.mateIn !== null,
      });
    }

    return buildGameReport(plies);
  }, [analyses, frames, history]);
}
