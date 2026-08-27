import {
  isTrainablePuzzleTheme,
  puzzleThemeLabel,
} from "../chess/puzzle-themes";

/**
 * Puzzle collections: a motif, a number, and something to show for it.
 *
 * The puzzle trainer already lets you filter by theme, so "solve twenty pins"
 * has been possible all along — what it has not been is *a thing*. A collection
 * is the difference between a filter and a goal: it names the target, counts
 * towards it while you play normally, and pays once when you get there.
 *
 * The counting is deliberately not a new ledger. Progress is the number of
 * distinct puzzles carrying the theme that you have a solved attempt for, which
 * is a query over rows that already exist — so a collection added today is
 * already half-finished for a player who has been training that motif for
 * months, rather than starting them at zero for work they have done. The only
 * row a collection writes is the claim, and that exists solely to keep the
 * payout exactly-once.
 *
 * A collection is defined here rather than in the database for the same reason
 * the bots and the chat phrases are: it is a catalog, and retuning one should
 * be an edit rather than a migration. The one thing that must never change is
 * an `id`, which is what a claim row points at.
 */

export type PuzzleCollection = {
  /** Stable forever: claims are keyed on it. */
  id: string;
  name: string;
  /** One line, shown under the name. */
  description: string;
  /** The `Puzzle.themes` tag that counts towards it. */
  theme: string;
  /** How many distinct puzzles carrying that theme finish it. */
  target: number;
  xpReward: number;
  coinReward: number;
};

/**
 * The reward for finishing one.
 *
 * Scaled off the target rather than set per collection, so adding a collection
 * is one line and cannot accidentally be worth ten times its neighbour. The
 * rates are a little under what the same number of puzzles pays on its own —
 * see `PUZZLE_REWARD` on the server: a collection is a bonus on top of work
 * that was already paid for, not a second wage for it.
 */
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

/**
 * The catalog, in the order it is offered — easiest first, so the list opens on
 * something a new player can finish rather than on the one that takes a month.
 *
 * Every theme here is `trainable`, and a test holds that: a collection built on
 * "crushing" or "middlegame" would be asking a player to grind a tag that
 * describes a puzzle rather than names a skill, and the trainer would not even
 * offer it as a filter.
 */
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

/** The collection with this id, or null when a claim names one since retired. */
export function findPuzzleCollection(id: string): PuzzleCollection | null {
  return BY_ID.get(id) ?? null;
}

/** Whether `id` names a collection. The API's guard at the door. */
export function isPuzzleCollectionId(id: string): boolean {
  return BY_ID.has(id);
}

/**
 * The label for a collection's theme, borrowed from the theme catalog rather
 * than written out again here — so a theme renamed there is renamed here too,
 * and a collection can never disagree with the filter it corresponds to.
 */
export function collectionThemeLabel(entry: PuzzleCollection): string {
  return puzzleThemeLabel(entry.theme);
}

/** Whether every collection trains a theme the trainer would actually offer. */
export function collectionsAreTrainable(): boolean {
  return PUZZLE_COLLECTIONS.every((entry) =>
    isTrainablePuzzleTheme(entry.theme),
  );
}
