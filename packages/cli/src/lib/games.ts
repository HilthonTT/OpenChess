import type { InferResponseType } from "hono/client";
import type { Difficulty, PromotionPiece } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails } from "./http-errors";

/**
 * Typed calls to the server's `/games` API. Every helper either returns the
 * decoded body or throws an `Error` whose message is the server's problem
 * detail, so screens can show it as-is.
 */

const byId = apiClient.games[":id"];

export type ServerGame = InferResponseType<typeof byId.$get, 200>;
export type ServerMoveResult = InferResponseType<
  (typeof byId.moves)["$post"],
  200
>;
export type ServerDifficulty = NonNullable<ServerGame["difficulty"]>;

/**
 * The server refused because the game moved on without us — a retried request
 * that already landed, or another session playing the same game. The cure is
 * always the same: refetch and trust the server's picture.
 */
export class GameConflictError extends Error {}

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  const problem = await getProblemDetails(response);
  const message = problem.detail ?? problem.title;

  return response.status === 409
    ? new GameConflictError(message)
    : new Error(message);
}

const TO_SERVER: Record<Difficulty, ServerDifficulty> = {
  easy: "EASY",
  medium: "MEDIUM",
  hard: "HARD",
};

const TO_ENGINE: Record<ServerDifficulty, Difficulty> = {
  EASY: "easy",
  MEDIUM: "medium",
  HARD: "hard",
};

export function toServerDifficulty(difficulty: Difficulty): ServerDifficulty {
  return TO_SERVER[difficulty];
}

export function toEngineDifficulty(
  difficulty: ServerDifficulty | null,
): Difficulty {
  return difficulty ? TO_ENGINE[difficulty] : "medium";
}

export async function createAiGame(input: {
  difficulty: ServerDifficulty;
  color: "white" | "black" | "random";
}): Promise<ServerGame> {
  const response = await apiClient.games.$post({ json: input });

  if (response.status !== 201) {
    throw await toError(response);
  }

  return response.json();
}

export type QueueResult = InferResponseType<
  typeof apiClient.games.pvp.queue.$post,
  200
>;

/**
 * One poll of the matchmaking queue. Each call doubles as the heartbeat that
 * keeps us eligible for pairing, so the caller is expected to keep calling
 * until it answers `matched`.
 */
export async function joinPvpQueue(): Promise<QueueResult> {
  const response = await apiClient.games.pvp.queue.$post();

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** Best-effort: if this never lands, the queue forgets us by timeout anyway. */
export async function leavePvpQueue(): Promise<void> {
  try {
    await apiClient.games.pvp.queue.$delete();
  } catch {
    // Nothing to do — see above.
  }
}

export async function fetchGame(id: string): Promise<ServerGame> {
  const response = await byId.$get({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** The newest unfinished AI game, so the screen can resume it instead of stranding it. */
export async function fetchActiveAiGame(): Promise<{ id: string } | null> {
  const response = await apiClient.games.active.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { games } = await response.json();
  return games.find((game) => game.mode === "AI") ?? null;
}

export async function sendMove(
  id: string,
  move: { from: string; to: string; promotion?: PromotionPiece; ply: number },
): Promise<ServerMoveResult> {
  const response = await byId.moves.$post({ param: { id }, json: move });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function resignGame(id: string): Promise<ServerGame> {
  const response = await byId.resign.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function abortGame(id: string): Promise<ServerGame> {
  const response = await byId.abort.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}
