import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Typed calls to the server's `/puzzles` API.
 *
 * The solving protocol is deliberately a round trip per move: the answer is the
 * thing being asked for, so the client is never handed the line. Every request
 * carries the whole attempt so far — the server replays it — which also makes a
 * retry of a request whose answer was never seen completely safe.
 */

const byId = apiClient.puzzles[":id"];

export type ServerPuzzle = NonNullable<
  InferResponseType<typeof apiClient.puzzles.next.$get, 200>["puzzle"]
>;
export type NextPuzzle = InferResponseType<
  typeof apiClient.puzzles.next.$get,
  200
>;
export type PuzzleMoveResult = InferResponseType<
  (typeof byId.moves)["$post"],
  200
>;
export type PuzzleAttemptEntry = InferResponseType<
  typeof apiClient.puzzles.attempts.$get,
  200
>["attempts"][number];

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  return new Error(problemMessage(await getProblemDetails(response)));
}

/**
 * A puzzle near your rating you have not been scored on. With `theme`, one
 * carrying that motif — still inside the rating band, so training a theme
 * cannot quietly hand you puzzles far above your level.
 */
export async function fetchNextPuzzle(
  theme: string | null = null,
): Promise<NextPuzzle> {
  const response = await apiClient.puzzles.next.$get({
    query: theme ? { theme } : {},
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export type PuzzleThemeEntry = InferResponseType<
  typeof apiClient.puzzles.themes.$get,
  200
>["themes"][number];

/** Every theme, with how many puzzles carry it and how you have done at it. */
export async function fetchPuzzleThemes(): Promise<PuzzleThemeEntry[]> {
  const response = await apiClient.puzzles.themes.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { themes } = await response.json();
  return themes;
}

/** Today's puzzle — the same one for every player. */
export async function fetchDailyPuzzle(): Promise<NextPuzzle> {
  const response = await apiClient.puzzles.daily.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/**
 * Play a move. `moves` is every move played on this puzzle so far, in order,
 * newest last — the opponent's replies are the server's and are not sent.
 */
export async function sendPuzzleMove(
  id: string,
  input: { moves: string[]; hintUsed?: boolean; msSpent?: number },
): Promise<PuzzleMoveResult> {
  const response = await byId.moves.$post({ param: { id }, json: input });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** The square the piece to move stands on. Halves what the solve is worth. */
export async function fetchPuzzleHint(
  id: string,
  moves: string[],
): Promise<{ square: string }> {
  const response = await byId.hint.$post({ param: { id }, json: { moves } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** Give up: settles the attempt as a failure and hands back the whole line. */
export async function revealPuzzle(
  id: string,
  moves: string[],
): Promise<{ solution: string[]; line: string[] }> {
  const response = await byId.reveal.$post({ param: { id }, json: { moves } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/* -------------------------------------------------------------------------- */
/* Puzzle Rush                                                                */
/* -------------------------------------------------------------------------- */

const rushById = apiClient.puzzles.rush[":id"];

export type RushMode = "THREE_MINUTE" | "FIVE_MINUTE" | "SURVIVAL";

/**
 * What to call each mode. Here rather than in a screen because two of them show
 * it — the rush board and the stats card — and a mode that reads "3 min" in one
 * place and "3 minutes" in the other is a mode a player has to think about.
 */
export const RUSH_MODE_LABEL: Record<RushMode, string> = {
  THREE_MINUTE: "3 min",
  FIVE_MINUTE: "5 min",
  SURVIVAL: "Survival",
};

/** The modes in the order they are offered, easiest commitment first. */
export const RUSH_MODES: RushMode[] = [
  "THREE_MINUTE",
  "FIVE_MINUTE",
  "SURVIVAL",
];

export type RushRun = InferResponseType<
  typeof apiClient.puzzles.rush.$post,
  201
>;
export type RushMoveResult = InferResponseType<
  (typeof rushById.moves)["$post"],
  200
>;
export type RushLeaderboardEntry = InferResponseType<
  typeof apiClient.puzzles.rush.leaderboard.$get,
  200
>["entries"][number];
export type RushBest = InferResponseType<
  typeof apiClient.puzzles.rush.bests.$get,
  200
>["bests"][number];

/** Start a run. Closes any run left open, so there is only ever one live. */
export async function startRush(mode: RushMode): Promise<RushRun> {
  const response = await apiClient.puzzles.rush.$post({ json: { mode } });

  if (response.status !== 201) {
    throw await toError(response);
  }

  return response.json();
}

/**
 * Play a move in a run. `moves` is every move played on the run's *current*
 * puzzle — the run itself is the server's to keep track of.
 */
export async function sendRushMove(
  id: string,
  moves: string[],
): Promise<RushMoveResult> {
  const response = await rushById.moves.$post({ param: { id }, json: { moves } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** Stop a run where it stands and bank the score. */
export async function endRush(id: string): Promise<RushRun> {
  const response = await rushById.end.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function fetchRushLeaderboard(
  mode: RushMode,
  limit = 20,
): Promise<RushLeaderboardEntry[]> {
  const response = await apiClient.puzzles.rush.leaderboard.$get({
    query: { mode, limit: String(limit) },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { entries } = await response.json();
  return entries;
}

/** Your best at each mode. */
export async function fetchRushBests(): Promise<RushBest[]> {
  const response = await apiClient.puzzles.rush.bests.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { bests } = await response.json();
  return bests;
}

/** Your recent attempts, newest first. */
export async function listPuzzleAttempts(
  limit = 20,
): Promise<PuzzleAttemptEntry[]> {
  const response = await apiClient.puzzles.attempts.$get({
    query: { limit: String(limit) },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { attempts } = await response.json();
  return attempts;
}
