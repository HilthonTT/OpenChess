import type { InferResponseType } from "hono/client";
import type { TimeControlKey } from "@openchess/shared";
import { apiClient } from "./api-client";
import { GameConflictError, type ServerGame } from "./games";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Typed calls to the server's `/challenges` API — playing someone you picked,
 * rather than whoever the queue hands you.
 */

const byId = apiClient.challenges[":id"];

export type ServerChallenge = InferResponseType<
  typeof apiClient.challenges.$get,
  200
>["incoming"][number];

export type ChallengeColor = "WHITE" | "BLACK" | "RANDOM";

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  const message = problemMessage(await getProblemDetails(response));

  // A 409 here is "someone got there first" or "you already have a game" —
  // both of which the screens answer by refetching, exactly as they do for a
  // game that moved on.
  return response.status === 409
    ? new GameConflictError(message)
    : new Error(message);
}

export async function listChallenges(): Promise<{
  incoming: ServerChallenge[];
  outgoing: ServerChallenge[];
}> {
  const response = await apiClient.challenges.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** Challenge a named player, or omit `opponent` for an open, code-only one. */
export async function createChallenge(input: {
  opponent?: string | null;
  color?: ChallengeColor;
  timeControl?: TimeControlKey | null;
}): Promise<ServerChallenge> {
  const response = await apiClient.challenges.$post({
    json: {
      opponent: input.opponent ?? null,
      color: input.color ?? "RANDOM",
      timeControl: input.timeControl ?? null,
    },
  });

  if (response.status !== 201) {
    throw await toError(response);
  }

  return response.json();
}

/** Turn a code someone read out into a challenge that can be accepted. */
export async function findChallengeByCode(
  code: string,
): Promise<ServerChallenge> {
  const response = await apiClient.challenges.code[":code"].$get({
    param: { code: code.trim().toUpperCase() },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function acceptChallenge(id: string): Promise<ServerGame> {
  const response = await byId.accept.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { game } = await response.json();
  return game;
}

export async function declineChallenge(
  id: string,
): Promise<ServerChallenge> {
  const response = await byId.decline.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function cancelChallenge(id: string): Promise<ServerChallenge> {
  const response = await byId.$delete({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/**
 * Offer the opponent of a finished online game another one: same clock,
 * colours swapped. It becomes an ordinary challenge in their list.
 */
export async function offerRematch(gameId: string): Promise<ServerChallenge> {
  const response = await apiClient.games[":id"].rematch.$post({
    param: { id: gameId },
  });

  if (response.status !== 201) {
    throw await toError(response);
  }

  return response.json();
}
