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

/** A puzzle near your rating you have not been scored on. */
export async function fetchNextPuzzle(): Promise<NextPuzzle> {
  const response = await apiClient.puzzles.next.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
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
