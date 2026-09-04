import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

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

export async function fetchPuzzleThemes(): Promise<PuzzleThemeEntry[]> {
  const response = await apiClient.puzzles.themes.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { themes } = await response.json();
  return themes;
}

export async function fetchDailyPuzzle(): Promise<NextPuzzle> {
  const response = await apiClient.puzzles.daily.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

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

const rushById = apiClient.puzzles.rush[":id"];

export type RushMode = "THREE_MINUTE" | "FIVE_MINUTE" | "SURVIVAL";

export const RUSH_MODE_LABEL: Record<RushMode, string> = {
  THREE_MINUTE: "3 min",
  FIVE_MINUTE: "5 min",
  SURVIVAL: "Survival",
};

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

export async function startRush(mode: RushMode): Promise<RushRun> {
  const response = await apiClient.puzzles.rush.$post({ json: { mode } });

  if (response.status !== 201) {
    throw await toError(response);
  }

  return response.json();
}

export async function sendRushMove(
  id: string,
  moves: string[],
): Promise<RushMoveResult> {
  const response = await rushById.moves.$post({
    param: { id },
    json: { moves },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

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

export async function fetchRushBests(): Promise<RushBest[]> {
  const response = await apiClient.puzzles.rush.bests.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { bests } = await response.json();
  return bests;
}

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

export type PuzzleCollectionEntry = InferResponseType<
  typeof apiClient.puzzles.collections.$get,
  200
>["collections"][number];

export type ClaimCollectionResult = InferResponseType<
  (typeof apiClient.puzzles.collections)[":id"]["claim"]["$post"],
  200
>;

export async function fetchPuzzleCollections(): Promise<
  PuzzleCollectionEntry[]
> {
  const response = await apiClient.puzzles.collections.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { collections } = await response.json();
  return collections;
}

export async function claimPuzzleCollection(
  id: string,
): Promise<ClaimCollectionResult> {
  const response = await apiClient.puzzles.collections[":id"].claim.$post({
    param: { id },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}
