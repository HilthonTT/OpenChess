import { db } from "@openchess/database/client";
import { isPlayablePuzzle } from "@openchess/shared";

/**
 * Import the Lichess puzzle database.
 *
 * The built-in catalog is a starter set of a dozen positions. This is where a
 * real corpus comes from: Lichess publishes its puzzle database as a CC0 CSV of
 * several million rows, in exactly the format `chess/puzzle.ts` speaks.
 *
 *     curl -O https://database.lichess.org/lichess_db_puzzle.csv.zst
 *     zstd -d lichess_db_puzzle.csv.zst
 *     bun run db:import-puzzles lichess_db_puzzle.csv --limit 20000
 *
 * The columns are, in order:
 *
 *     PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
 *
 * Every row is replayed through the engine before it is written. A corpus this
 * size will contain rows this engine cannot replay — a promotion spelled
 * differently, a position it reads as already terminal — and one unplayable row
 * reaching the table is a puzzle a player cannot solve and cannot escape. They
 * are counted and skipped rather than being allowed to fail the whole import.
 *
 * Rows are upserted by `externalId`, so a rerun with a newer dump rewrites
 * ratings in place and leaves players' attempts attached.
 *
 * @see https://database.lichess.org/#puzzles
 */

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
    // Defaulted rather than unbounded: the full dump is millions of rows, and
    // an accidental full import is a long wait and a large table.
    limit: number("limit", 10_000),
    minRating: number("min-rating", 400),
    maxRating: number("max-rating", 2400),
    batchSize: number("batch-size", 500),
  };
}

/**
 * Split one CSV line.
 *
 * The Lichess dump quotes nothing and embeds no commas in its fields, so a
 * plain split is correct for it — but a quoted field would silently corrupt
 * every column after it, so quoting is honoured rather than assumed away.
 */
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

/** One CSV line as a puzzle row, or null when it is not one we can use. */
function toRow(line: string, options: Options): Row | null {
  const fields = splitCsvLine(line);
  const [id, fen, moves, rating, , , , themes, gameUrl] = fields;

  if (!id || !fen || !moves || !rating) {
    return null;
  }

  // The header line, if the dump still carries one.
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
  // `createMany` with `skipDuplicates` would leave a rerun's rating updates on
  // the floor, so each row is upserted. Slower, and the only shape that makes a
  // reimport of a newer dump mean anything.
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

/** Consume one complete line; returns false once the import should stop. */
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

  // The check that keeps an unsolvable puzzle out of the table. It is a full
  // replay through the engine, which is why the import is not instant.
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

// The last line of a file with no trailing newline.
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
