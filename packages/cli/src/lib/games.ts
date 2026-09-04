import type { InferResponseType } from "hono/client";
import type {
  ChatPhraseId,
  Difficulty,
  PersonalityId,
  PromotionPiece,
  TimeControlKey,
} from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

const byId = apiClient.games[":id"];

export type ServerGame = InferResponseType<typeof byId.$get, 200>;
export type ServerMoveResult = InferResponseType<
  (typeof byId.moves)["$post"],
  200
>;
export type ServerDifficulty = NonNullable<ServerGame["difficulty"]>;

export class GameConflictError extends Error {}

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  const problem = await getProblemDetails(response);
  const message = problemMessage(problem);

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
  personality: PersonalityId;
  color: "white" | "black" | "random";
  timeControl?: TimeControlKey | null;
  variant?: "STANDARD" | "CHESS960";
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

export async function joinPvpQueue(
  timeControl: TimeControlKey | null = null,
): Promise<QueueResult> {
  const response = await apiClient.games.pvp.queue.$post({
    json: { timeControl },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function leavePvpQueue(): Promise<void> {
  try {
    await apiClient.games.pvp.queue.$delete();
  } catch {}
}

export async function fetchGame(id: string): Promise<ServerGame> {
  const response = await byId.$get({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

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

export async function claimVictory(id: string): Promise<ServerGame> {
  const response = await byId.claim.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function offerDraw(id: string): Promise<ServerGame> {
  const response = await byId.draw.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function acceptDraw(id: string): Promise<ServerGame> {
  const response = await byId.draw.accept.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function declineDraw(id: string): Promise<ServerGame> {
  const response = await byId.draw.$delete({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function offerTakeback(id: string): Promise<ServerGame> {
  const response = await byId.takeback.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function acceptTakeback(id: string): Promise<ServerGame> {
  const response = await byId.takeback.accept.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function declineTakeback(id: string): Promise<ServerGame> {
  const response = await byId.takeback.$delete({ param: { id } });

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

export async function flagGame(id: string): Promise<ServerGame> {
  const response = await byId.flag.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export type ChatMessage = ServerGame["chat"][number];

export async function sendChatMessage(
  id: string,
  phrase: ChatPhraseId,
): Promise<ChatMessage[]> {
  const response = await byId.chat.$post({ param: { id }, json: { phrase } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { chat } = await response.json();
  return chat;
}

export type GameHistoryEntry = InferResponseType<
  typeof apiClient.games.$get,
  200
>["games"][number];

export async function listFinishedGames(input?: {
  limit?: number;
  cursor?: string;
}): Promise<{ games: GameHistoryEntry[]; nextCursor: string | null }> {
  const response = await apiClient.games.$get({
    query: {
      limit: String(input?.limit ?? 20),
      ...(input?.cursor ? { cursor: input.cursor } : {}),
    },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}
