import type { EvalWeights } from "../chess/evaluate";
import {
  playTrainingGame,
  type TrainingLimits,
  type TrainingPlayer,
} from "../chess/learning/self-play";
import {
  type Outcome,
  type TdLeafOptions,
  tdLeafGradient,
} from "../chess/learning/td-leaf";
import type { Color } from "../chess/types";

declare const self: Worker;

export type TrainJob = {
  id: number;
  kind: "train";
  learner: EvalWeights;
  opponent: TrainingPlayer;
  learnerColor: Color;
  limits: TrainingLimits;
  td: TdLeafOptions;
};

export type MatchJob = {
  id: number;
  kind: "match";
  learner: TrainingPlayer;
  opponent: TrainingPlayer;
  learnerColor: Color;
  limits: TrainingLimits;
};

export type Job = TrainJob | MatchJob;

export type JobResult = {
  id: number;
  outcome: Outcome;
  plies: number;
  gradient: number[] | null;
};

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;

  if (job.kind === "match") {
    const game = playTrainingGame({
      learner: job.learner,
      opponent: job.opponent,
      learnerColor: job.learnerColor,
      limits: job.limits,
      record: false,
    });
    const result: JobResult = {
      id: job.id,
      outcome: game.outcome,
      plies: game.plies,
      gradient: null,
    };
    self.postMessage(result);
    return;
  }

  const game = playTrainingGame({
    learner: { weights: job.learner },
    opponent: job.opponent,
    learnerColor: job.learnerColor,
    limits: job.limits,
  });
  const gradient = tdLeafGradient(
    game.leaves,
    game.outcome,
    job.learnerColor,
    job.learner,
    job.td,
  );
  const result: JobResult = {
    id: job.id,
    outcome: game.outcome,
    plies: game.plies,
    gradient: Array.from(gradient),
  };
  self.postMessage(result);
};
