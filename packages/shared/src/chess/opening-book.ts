import { repetitionKey } from "./board";
import { createGame, play } from "./game";
import type { Game } from "./game";
import { findMove, generateLegalMoves } from "./moves";
import { OPENING_LINES } from "./opening-lines";
import { toSan } from "./san";
import type { Move, Position } from "./types";

/**
 * The opening book: what to play before the search is worth running, and what to
 * call the position once it has been played.
 *
 * `opening-lines.ts` holds the book as named lines, which is the form a human can
 * edit. This turns that list into the form everything else wants — a map from
 * position to its known continuations — and answers the three questions asked of
 * it: what may be played here, which of those to play, and what this position is
 * called.
 *
 * Positions are keyed by `repetitionKey`, the same key threefold repetition uses.
 * That makes the book transposition-aware for free: `1.e4 e5 2.Nf3 Nc6 3.Bc4` and
 * `1.e4 e5 2.Bc4 Nc6 3.Nf3` are one key, so both are the Italian and both offer
 * the Italian's continuations. Keying on the move list instead would have made
 * them two different openings, which is the sort of thing that is obvious on a
 * board and invisible in a trie.
 *
 * The book is built on first use rather than at import. Replaying every line
 * costs a few tens of milliseconds of move generation, and a session that never
 * plays the bot and never opens the explorer should not pay it.
 */

/** What the book calls a position. */
export type OpeningName = {
  /** ECO code, e.g. `C50`. */
  eco: string;
  name: string;
};

/** A continuation the book knows from some position. */
export type BookMove = {
  /** SAN, without check or mate decoration. */
  san: string;
  move: Move;
  /** Summed weight of the lines running through this move. */
  weight: number;
  /** This move's share of the book's weight at this position, 0 to 1. */
  share: number;
  /** What the position after this move is called, when the book names it. */
  leadsTo: OpeningName | null;
};

type BookEdge = {
  san: string;
  move: Move;
  weight: number;
  /** Key of the position this move reaches, for naming without replaying. */
  to: string;
};

type BookNode = {
  name: OpeningName | null;
  edges: BookEdge[];
  totalWeight: number;
};

type Book = {
  nodes: Map<string, BookNode>;
  /** Plies in the longest line, which bounds how deep a name can be found. */
  maxPlies: number;
  /** Lines that did not replay and were dropped. Zero, or the book is broken. */
  skipped: string[];
};

/**
 * Check and mate suffixes are decoration and the annotations are not part of the
 * move, exactly as `findSanMove` treats them — so a line may be written with or
 * without them and still match.
 */
function normalizeSan(san: string): string {
  return san
    .replace(/[+#?!]+$/, "")
    .replace(/0/g, "O")
    .trim();
}

/** Every legal move in `position`, indexed by its normalized SAN. */
function sanTable(position: Position): Map<string, Move> {
  const legal = generateLegalMoves(position);
  const table = new Map<string, Move>();

  for (const move of legal) {
    table.set(normalizeSan(toSan(position, move, legal)), move);
  }

  return table;
}

function buildBook(): Book {
  const nodes = new Map<string, BookNode>();
  // One SAN table per position, not per line. Lines share their prefixes — every
  // 1.e4 line walks the same first node — so without this the build would
  // re-generate the same move list dozens of times.
  const tables = new Map<string, Map<string, Move>>();
  const skipped: string[] = [];
  let maxPlies = 0;

  const nodeAt = (key: string): BookNode => {
    let node = nodes.get(key);
    if (!node) {
      node = { name: null, edges: [], totalWeight: 0 };
      nodes.set(key, node);
    }
    return node;
  };

  for (const line of OPENING_LINES) {
    const weight = line.weight ?? 1;
    let game = createGame();
    let played = 0;

    for (const san of line.moves) {
      const key = repetitionKey(game.position);

      let table = tables.get(key);
      if (!table) {
        table = sanTable(game.position);
        tables.set(key, table);
      }

      const wanted = normalizeSan(san);
      const move = table.get(wanted);
      if (!move) {
        break;
      }

      const next = play(game, move);
      const to = repetitionKey(next.position);

      const node = nodeAt(key);
      const existing = node.edges.find((edge) => edge.san === wanted);
      if (existing) {
        existing.weight += weight;
      } else {
        node.edges.push({ san: wanted, move, weight, to });
      }
      node.totalWeight += weight;

      game = next;
      played += 1;
    }

    // A line that did not play out in full is dropped rather than allowed to
    // half-register: the moves it did contribute are already in the trie, but
    // the position it claims to name was never reached, so naming it would put
    // the wrong label on whatever the line stopped at. The build carries on so
    // one bad line cannot cost the whole book — and `openingBookStats` reports
    // it, which is what `opening-book.test.ts` fails on.
    if (played < line.moves.length) {
      skipped.push(line.name);
      continue;
    }

    maxPlies = Math.max(maxPlies, line.moves.length);

    // First line to reach a position names it. Two lines that transpose into one
    // another therefore agree on a name instead of racing; the test refuses a
    // pair that disagrees.
    const final = nodeAt(repetitionKey(game.position));
    if (final.name === null) {
      final.name = { eco: line.eco, name: line.name };
    }
  }

  for (const node of nodes.values()) {
    node.edges.sort(
      (a, b) => b.weight - a.weight || a.san.localeCompare(b.san),
    );
  }

  return { nodes, maxPlies, skipped };
}

let book: Book | null = null;

function getBook(): Book {
  if (book === null) {
    book = buildBook();
  }
  return book;
}

/**
 * The continuations the book knows from `position`, most-played first. Empty
 * once the game has left the book, which is also how a caller tells that it has.
 */
export function bookMoves(position: Position): BookMove[] {
  const { nodes } = getBook();
  const node = nodes.get(repetitionKey(position));

  if (!node) {
    return [];
  }

  return node.edges.map((edge) => ({
    san: edge.san,
    move: edge.move,
    weight: edge.weight,
    share: edge.weight / node.totalWeight,
    leadsTo: nodes.get(edge.to)?.name ?? null,
  }));
}

/**
 * Pick a book move for `position`, weighted by how much of the book runs through
 * each one, or null when the position is not in the book.
 *
 * Weighted rather than always-the-mainline so the bot does not play out the same
 * eight moves every game: a book that answers 1.e4 with 1...c5 every single time
 * is a book you have finished reading after two games.
 *
 * `random` is injectable so a test can pin the choice; it must return a value in
 * [0, 1) the way `Math.random` does.
 */
export function chooseBookMove(
  position: Position,
  random: () => number = Math.random,
): Move | null {
  const node = getBook().nodes.get(repetitionKey(position));

  if (!node || node.edges.length === 0) {
    return null;
  }

  let ticket = random() * node.totalWeight;
  for (const edge of node.edges) {
    ticket -= edge.weight;
    if (ticket < 0) {
      // Resolve against this position's own legal moves rather than handing back
      // the shared move the book was built with. They describe the same move —
      // the key guarantees the boards are identical — but a caller that reads
      // the object rather than replaying it should get one that belongs to the
      // position it asked about.
      return (
        findMove(
          generateLegalMoves(position),
          edge.move.from,
          edge.move.to,
          edge.move.promotion ?? undefined,
        ) ?? null
      );
    }
  }

  // Only reachable if the weights sum short of the ticket through floating point
  // error, in which case the last edge is the one the ticket was inside of.
  const last = node.edges[node.edges.length - 1]!;
  return (
    findMove(
      generateLegalMoves(position),
      last.move.from,
      last.move.to,
      last.move.promotion ?? undefined,
    ) ?? null
  );
}

/** What the book calls this exact position, or null if it does not name it. */
export function namedOpening(position: Position): OpeningName | null {
  return getBook().nodes.get(repetitionKey(position))?.name ?? null;
}

/**
 * What `game` has played, as the deepest opening it has passed through.
 *
 * The deepest rather than the current position's, because a game leaves the book
 * long before it stops being a Sicilian: at move 20 no position is named, and the
 * answer wanted is still the name of the last one that was. Positions past the
 * longest line in the book cannot be named, so the walk stops there rather than
 * keying every position of a hundred-move game.
 */
export function openingOf(game: Game): OpeningName | null {
  const { nodes, maxPlies } = getBook();
  const plies = Math.min(game.history.length, maxPlies);

  let found: OpeningName | null = null;

  for (let ply = 1; ply <= plies; ply += 1) {
    // The position after `ply` moves: the one the next move was made from, or
    // the game's current position when `ply` is the last.
    const position =
      ply < game.history.length ? game.history[ply]!.before : game.position;

    const name = nodes.get(repetitionKey(position))?.name;
    if (name) {
      found = name;
    }
  }

  return found;
}

/** Size of the built book, and what it had to drop. For tests and diagnostics. */
export function openingBookStats(): {
  lines: number;
  positions: number;
  maxPlies: number;
  skipped: string[];
} {
  const { nodes, maxPlies, skipped } = getBook();
  return {
    lines: OPENING_LINES.length,
    positions: nodes.size,
    maxPlies,
    skipped,
  };
}
