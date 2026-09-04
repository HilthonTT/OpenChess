import { db } from "@openchess/database/client";
import { isPlayablePuzzle } from "@openchess/shared";

type Options = {
  path: string;
  limit: number;
  minRating: number;
  maxRating: number;
  batchSize: number;
};

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=");
      flags.set(name!, inline ?? argv[++i] ?? "");
    } else {
      positional.push(arg);
    }
  }

  const path = positional[0];
  if (!path) {
    throw new Error(
      "Usage: bun run db:import-puzzles <lichess_db_puzzle.csv> [--limit N] [--min-rating N] [--max-rating N]",
    );
  }

  const number = (name: string, fallback: number): number => {
    const raw = flags.get(name);
    if (raw === undefined || raw === "") {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new Error(`--${name} must be a number, got "${raw}"`);
    }
    return value;
  };

  return {
    path,
    limit: number("limit", 10_000),
    minRating: number("min-rating", 400),
    maxRating: number("max-rating", 2400),
    batchSize: number("batch-size", 500),
  };
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;

    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }

  fields.push(field);
  return fields;
}

type Row = {
  externalId: string;
  fen: string;
  moves: string[];
  rating: number;
  themes: string[];
  sourceUrl: string | null;
};

function toRow(line: string, options: Options): Row | null {
  const fields = splitCsvLine(line);
  const [id, fen, moves, rating, , , , themes, gameUrl] = fields;

  if (!id || !fen || !moves || !rating) {
    return null;
  }

  if (id === "PuzzleId") {
    return null;
  }

  const parsedRating = Number(rating);
  if (
    !Number.isFinite(parsedRating) ||
    parsedRating < options.minRating ||
    parsedRating > options.maxRating
  ) {
    return null;
  }

  const uci = moves.split(" ").filter((move) => move !== "");

  return {
    externalId: `lichess:${id}`,
    fen,
    moves: uci,
    rating: Math.round(parsedRating),
    themes: (themes ?? "").split(" ").filter((theme) => theme !== ""),
    sourceUrl: gameUrl || null,
  };
}

async function writeBatch(batch: Row[]): Promise<void> {
  await db.$transaction(
    batch.map((row) => {
      const { externalId, ...rest } = row;
      return db.puzzle.upsert({
        where: { externalId },
        update: rest,
        create: row,
      });
    }),
  );
}

const options = parseArgs(process.argv.slice(2));

const file = Bun.file(options.path);
if (!(await file.exists())) {
  throw new Error(`No such file: ${options.path}`);
}

let read = 0;
let written = 0;
let skippedRange = 0;
let skippedUnplayable = 0;

let batch: Row[] = [];
let buffer = "";

const flush = async () => {
  if (batch.length === 0) {
    return;
  }
  await writeBatch(batch);
  written += batch.length;
  batch = [];
  console.log(`  …${written} written`);
};

async function handleLine(line: string): Promise<boolean> {
  if (line.trim() === "") {
    return true;
  }

  read += 1;

  const row = toRow(line, options);
  if (!row) {
    skippedRange += 1;
    return true;
  }

  if (!isPlayablePuzzle(row)) {
    skippedUnplayable += 1;
    return true;
  }

  batch.push(row);

  if (batch.length >= options.batchSize) {
    await flush();
  }

  return written + batch.length < options.limit;
}

console.log(
  `Importing up to ${options.limit} puzzles rated ${options.minRating}–${options.maxRating} from ${options.path}…`,
);

const stream = file.stream();
const decoder = new TextDecoder();

outer: for await (const chunk of stream) {
  buffer += decoder.decode(chunk, { stream: true });

  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);

    if (!(await handleLine(line))) {
      break outer;
    }

    newline = buffer.indexOf("\n");
  }
}

if (buffer.trim() !== "" && written + batch.length < options.limit) {
  await handleLine(buffer.replace(/\r$/, ""));
}

await flush();

console.log(
  [
    `Read ${read} rows.`,
    `Wrote ${written} puzzles.`,
    `Skipped ${skippedRange} outside the rating range or malformed.`,
    `Skipped ${skippedUnplayable} whose line would not replay.`,
  ].join("\n"),
);

await db.$disconnect();
