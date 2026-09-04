import { createGame, play } from "./game";
import type { Game } from "./game";
import { findMove, generateLegalMoves, repetitionKey } from "./moves";
import { OPENING_LINES, type OpeningStyle } from "./opening-lines";
import { toSan } from "./san";
import type { Move, Position } from "./types";

export type OpeningName = {
  eco: string;
  name: string;
};

export type BookMove = {
  san: string;
  move: Move;
  weight: number;
  share: number;
  leadsTo: OpeningName | null;
};

type BookEdge = {
  san: string;
  move: Move;
  weight: number;
  to: string;
  styles: Partial<Record<OpeningStyle, number>>;
};

type BookNode = {
  name: OpeningName | null;
  edges: BookEdge[];
  totalWeight: number;
};

type Book = {
  nodes: Map<string, BookNode>;
  maxPlies: number;
  skipped: string[];
};

function normalizeSan(san: string): string {
  return san
    .replace(/[+#?!]+$/, "")
    .replace(/0/g, "O")
    .trim();
}

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
      const edge = existing ?? { san: wanted, move, weight: 0, to, styles: {} };
      if (!existing) {
        node.edges.push(edge);
      }

      edge.weight += weight;
      if (line.style) {
        edge.styles[line.style] = (edge.styles[line.style] ?? 0) + weight;
      }
      node.totalWeight += weight;

      game = next;
      played += 1;
    }

    if (played < line.moves.length) {
      skipped.push(line.name);
      continue;
    }

    maxPlies = Math.max(maxPlies, line.moves.length);

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

export type BookChoice = {
  random?: () => number;
  style?: OpeningStyle | null;
  bias?: number;
};

function edgeWeight(edge: BookEdge, choice: BookChoice): number {
  if (!choice.style) {
    return edge.weight;
  }
  return edge.weight + (choice.bias ?? 3) * (edge.styles[choice.style] ?? 0);
}

export function chooseBookMove(
  position: Position,
  choice: BookChoice = {},
): Move | null {
  const node = getBook().nodes.get(repetitionKey(position));

  if (!node || node.edges.length === 0) {
    return null;
  }

  const random = choice.random ?? Math.random;
  const total = node.edges.reduce(
    (sum, edge) => sum + edgeWeight(edge, choice),
    0,
  );

  let ticket = random() * total;
  for (const edge of node.edges) {
    ticket -= edgeWeight(edge, choice);
    if (ticket < 0) {
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

export function namedOpening(position: Position): OpeningName | null {
  return getBook().nodes.get(repetitionKey(position))?.name ?? null;
}

export function openingOf(game: Game): OpeningName | null {
  const { nodes, maxPlies } = getBook();
  const plies = Math.min(game.history.length, maxPlies);

  let found: OpeningName | null = null;

  for (let ply = 1; ply <= plies; ply += 1) {
    const position =
      ply < game.history.length ? game.history[ply]!.before : game.position;

    const name = nodes.get(repetitionKey(position))?.name;
    if (name) {
      found = name;
    }
  }

  return found;
}

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
