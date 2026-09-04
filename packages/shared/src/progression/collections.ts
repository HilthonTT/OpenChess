import {
  isTrainablePuzzleTheme,
  puzzleThemeLabel,
} from "../chess/puzzle-themes";

export type PuzzleCollection = {
  id: string;
  name: string;
  description: string;
  theme: string;
  target: number;
  xpReward: number;
  coinReward: number;
};

function rewardFor(target: number): { xpReward: number; coinReward: number } {
  return { xpReward: target * 6, coinReward: target * 4 };
}

function collection(
  id: string,
  theme: string,
  target: number,
  name: string,
  description: string,
): PuzzleCollection {
  return { id, name, description, theme, target, ...rewardFor(target) };
}

export const PUZZLE_COLLECTIONS: readonly PuzzleCollection[] = [
  collection(
    "forks-10",
    "fork",
    10,
    "Two at once",
    "Ten forks. The first thing anyone learns to look for.",
  ),
  collection(
    "back-rank-15",
    "backRankMate",
    15,
    "The last rank",
    "Fifteen back-rank mates. Look at their king's escape squares.",
  ),
  collection(
    "skewers-15",
    "skewer",
    15,
    "Through and through",
    "Fifteen skewers. A pin from the other end.",
  ),
  collection(
    "pins-20",
    "pin",
    20,
    "Nailed down",
    "Twenty pins — the piece that cannot move, and what to do about it.",
  ),
  collection(
    "discovered-20",
    "discoveredAttack",
    20,
    "Out of the way",
    "Twenty discovered attacks, where the piece that moves is not the threat.",
  ),
  collection(
    "quiet-20",
    "quietMove",
    20,
    "Say nothing",
    "Twenty quiet moves. No check, no capture, and no defence to it.",
  ),
  collection(
    "sacrifices-25",
    "sacrifice",
    25,
    "Give it up",
    "Twenty-five sacrifices. Material is not the point of any of them.",
  ),
  collection(
    "mate-in-two-30",
    "mateIn2",
    30,
    "Two to go",
    "Thirty mates in two. Forcing moves first: checks, captures, threats.",
  ),
  collection(
    "endgames-30",
    "rookEndgame",
    30,
    "Rooks and pawns",
    "Thirty rook endgames, the ones that decide most long games.",
  ),
];

const BY_ID = new Map(PUZZLE_COLLECTIONS.map((entry) => [entry.id, entry]));

export function findPuzzleCollection(id: string): PuzzleCollection | null {
  return BY_ID.get(id) ?? null;
}

export function isPuzzleCollectionId(id: string): boolean {
  return BY_ID.has(id);
}

export function collectionThemeLabel(entry: PuzzleCollection): string {
  return puzzleThemeLabel(entry.theme);
}

export function collectionsAreTrainable(): boolean {
  return PUZZLE_COLLECTIONS.every((entry) =>
    isTrainablePuzzleTheme(entry.theme),
  );
}
