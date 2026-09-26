import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_EVAL_WEIGHTS,
  EVAL_TERMS,
  type EvalWeights,
} from "../chess/evaluate";
import { type MatchResult, tallyMatch } from "../chess/learning/match";
import type {
  TrainingLimits,
  TrainingPlayer,
} from "../chess/learning/self-play";
import type { Outcome, TdLeafOptions } from "../chess/learning/td-leaf";
import {
  clampWeights,
  roundWeights,
  vectorToWeights,
  weightsToVector,
} from "../chess/learning/weights";
import { PERSONALITIES, type PersonalityId } from "../chess/personality";
import type { Color } from "../chess/types";
import type { Job, JobResult } from "./train-worker";

type Snapshot = { generation: number; weights: EvalWeights };

type GenerationLog = {
  generation: number;
  training: MatchResult;
  averagePlies: number;
  weights: EvalWeights;
  gate: MatchResult | null;
  promoted: boolean;
};

type TrainingRun = {
  version: 1;
  generation: number;
  weights: EvalWeights;
  champion: Snapshot;
  pool: Snapshot[];
  log: GenerationLog[];
};

const BOTS: PersonalityId[] = [
  "gambiteer",
  "fortress",
  "grinder",
  "tactician",
  "maestro",
];

const { values: args } = parseArgs({
  options: {
    generations: { type: "string", default: "20" },
    games: { type: "string", default: "64" },
    workers: { type: "string", default: String(availableParallelism()) },
    depth: { type: "string", default: "2" },
    nodes: { type: "string" },
    alpha: { type: "string", default: "0.05" },
    lambda: { type: "string", default: "0.7" },
    scale: { type: "string", default: "400" },
    "gate-games": { type: "string", default: "32" },
    "gate-score": { type: "string", default: "0.55" },
    "bench-games": { type: "string", default: "100" },
    start: { type: "string", default: "default" },
    out: { type: "string", default: ".training/student.json" },
    resume: { type: "boolean", default: false },
  },
});

const generations = Number(args.generations);
const gamesPerGeneration = Number(args.games);
const workerCount = Math.max(1, Number(args.workers));
const alpha = Number(args.alpha);
const gateGames = Number(args["gate-games"]);
const gateScore = Number(args["gate-score"]);
const benchGames = Number(args["bench-games"]);
const limits: TrainingLimits = {
  depth: Number(args.depth),
  nodes: args.nodes === undefined ? undefined : Number(args.nodes),
};
const td: TdLeafOptions = {
  lambda: Number(args.lambda),
  scale: Number(args.scale),
};

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function startingWeights(start: string): EvalWeights {
  if (start === "default") {
    return { ...DEFAULT_EVAL_WEIGHTS };
  }
  if (start === "scrambled") {
    const scrambled = {} as EvalWeights;
    for (const term of EVAL_TERMS) {
      scrambled[term] = 0.3 + Math.random() * 1.7;
    }
    return scrambled;
  }
  if (start in PERSONALITIES) {
    return { ...PERSONALITIES[start as PersonalityId].weights };
  }
  const run = JSON.parse(readFileSync(start, "utf8")) as TrainingRun;
  return run.weights;
}

function loadRun(): TrainingRun {
  if (args.resume && existsSync(args.out)) {
    return JSON.parse(readFileSync(args.out, "utf8")) as TrainingRun;
  }
  const weights = clampWeights(startingWeights(args.start));
  return {
    version: 1,
    generation: 0,
    weights,
    champion: { generation: 0, weights },
    pool: [{ generation: 0, weights }],
    log: [],
  };
}

function saveRun(run: TrainingRun): void {
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(run, null, 2)}\n`);
}

class WorkerPool {
  private readonly workers: Worker[];

  constructor(size: number) {
    this.workers = Array.from(
      { length: size },
      () => new Worker(new URL("./train-worker.ts", import.meta.url)),
    );
  }

  run(jobs: Job[]): Promise<JobResult[]> {
    const results: JobResult[] = new Array(jobs.length);
    let next = 0;
    let done = 0;

    return new Promise((resolve, reject) => {
      if (jobs.length === 0) {
        resolve(results);
        return;
      }

      const feed = (worker: Worker) => {
        const job = jobs[next];
        next += 1;
        if (!job) {
          return;
        }
        worker.onmessage = (event: MessageEvent<JobResult>) => {
          results[event.data.id] = event.data;
          done += 1;
          if (done === jobs.length) {
            resolve(results);
          } else {
            feed(worker);
          }
        };
        worker.onerror = (event) => reject(event.error ?? event.message);
        worker.postMessage(job);
      };

      for (const worker of this.workers) {
        feed(worker);
      }
    });
  }

  close(): void {
    for (const worker of this.workers) {
      worker.terminate();
    }
  }
}

function colorOf(index: number): Color {
  return index % 2 === 0 ? "w" : "b";
}

function chooseOpponent(run: TrainingRun): TrainingPlayer {
  const roll = Math.random();
  if (roll < 0.5) {
    return { weights: run.weights };
  }
  if (roll < 0.8) {
    return { weights: pick(run.pool).weights };
  }
  const bot = PERSONALITIES[pick(BOTS)];
  return { weights: bot.weights, contempt: bot.contempt };
}

async function playMatch(
  pool: WorkerPool,
  learner: TrainingPlayer,
  opponent: TrainingPlayer,
  games: number,
): Promise<MatchResult> {
  const jobs: Job[] = Array.from({ length: games }, (_, id) => ({
    id,
    kind: "match",
    learner,
    opponent,
    learnerColor: colorOf(id),
    limits,
  }));
  const results = await pool.run(jobs);
  return tallyMatch(results.map((result) => result.outcome));
}

function formatMatch(result: MatchResult): string {
  const elo =
    result.elo >= 0 ? `+${result.elo.toFixed(0)}` : result.elo.toFixed(0);
  return `+${result.wins} =${result.draws} -${result.losses} (${(result.score * 100).toFixed(1)}%, ${elo} Elo)`;
}

function formatWeights(weights: EvalWeights): string {
  return EVAL_TERMS.map((term) => `${term}=${weights[term].toFixed(3)}`).join(
    " ",
  );
}

async function trainGeneration(
  pool: WorkerPool,
  run: TrainingRun,
): Promise<void> {
  const generation = run.generation + 1;
  const jobs: Job[] = Array.from({ length: gamesPerGeneration }, (_, id) => ({
    id,
    kind: "train",
    learner: run.weights,
    opponent: chooseOpponent(run),
    learnerColor: colorOf(id),
    limits,
    td,
  }));

  const started = performance.now();
  const results = await pool.run(jobs);

  const step = new Float64Array(EVAL_TERMS.length);
  let plies = 0;
  const outcomes: Outcome[] = [];
  for (const result of results) {
    outcomes.push(result.outcome);
    plies += result.plies;
    for (const [index, value] of (result.gradient ?? []).entries()) {
      step[index]! += (alpha * value) / results.length;
    }
  }

  const vector = weightsToVector(run.weights);
  for (let index = 0; index < vector.length; index += 1) {
    vector[index]! += step[index]!;
  }
  run.weights = roundWeights(clampWeights(vectorToWeights(vector)), 5);
  run.generation = generation;

  const training = tallyMatch(outcomes);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(
    `gen ${generation}  ${gamesPerGeneration} games in ${seconds}s  learner ${formatMatch(training)}`,
  );
  console.log(`  ${formatWeights(run.weights)}`);

  let gate: MatchResult | null = null;
  let promoted = false;
  if (gateGames > 0) {
    gate = await playMatch(
      pool,
      { weights: run.weights },
      { weights: run.champion.weights },
      gateGames,
    );
    promoted = gate.score >= gateScore;
    console.log(
      `  vs champion (gen ${run.champion.generation}): ${formatMatch(gate)}${promoted ? "  → promoted" : ""}`,
    );
    if (promoted) {
      run.champion = { generation, weights: run.weights };
      run.pool.push(run.champion);
    }
  }

  run.log.push({
    generation,
    training,
    averagePlies: plies / results.length,
    weights: run.weights,
    gate,
    promoted,
  });
}

async function main(): Promise<void> {
  const run = loadRun();
  const pool = new WorkerPool(workerCount);

  console.log(
    `training from gen ${run.generation}: ${generations} generations × ${gamesPerGeneration} games, depth ${limits.depth}, ${workerCount} workers, α=${alpha} λ=${td.lambda}`,
  );
  console.log(`  ${formatWeights(run.weights)}`);

  try {
    for (let index = 0; index < generations; index += 1) {
      await trainGeneration(pool, run);
      saveRun(run);
    }

    if (benchGames > 0) {
      const maestro = PERSONALITIES.maestro;
      const bench = await playMatch(
        pool,
        { weights: run.champion.weights },
        { weights: maestro.weights, contempt: maestro.contempt },
        benchGames,
      );
      console.log(
        `champion (gen ${run.champion.generation}) vs Maestro's weights at depth ${limits.depth}: ${formatMatch(bench)}`,
      );
    }
  } finally {
    pool.close();
  }

  console.log(`saved to ${args.out}`);
}

await main();
