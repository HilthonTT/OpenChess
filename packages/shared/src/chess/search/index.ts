/**
 * The search: alpha-beta over `evaluate`, and everything that makes it look
 * further than it otherwise would within a fixed budget.
 *
 * The depth a search reaches is not a matter of patience but of how many
 * positions it can decline to look at. Every part below exists to prune:
 * a transposition table so a position reached twice is scored once, move
 * ordering so the refutation is tried first and the rest cut off behind it,
 * iterative deepening so each pass has the last one's best guess to order by,
 * null moves and reductions to write off the unpromising cheaply, and a capture
 * search at the horizon so a leaf score means something.
 *
 * Scores are centipawns from the side-to-move's point of view, as negamax needs
 * them. `ply` counts from the root, so a mate found deeper scores lower than the
 * same mate found sooner and the search prefers the quick kill.
 */

export { MATE_SCORE, MATE_THRESHOLD } from "./constants";
export type { SearchLimits, SearchResult } from "./constants";
export { see } from "./exchange";
export { search } from "./iterative";
