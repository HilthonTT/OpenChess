import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Watching games you are not playing in.
 *
 * The spectator view is a different shape from a player's — no colour of your
 * own, no legal moves — which is the point: there is nothing here a watcher
 * could act on, so the screen built from it cannot accidentally offer to.
 */

export type LiveGame = InferResponseType<
  typeof apiClient.games.live.$get,
  200
>["games"][number];

export type SpectatorGame = InferResponseType<
  (typeof apiClient.games)[":id"]["watch"]["$get"],
  200
>;

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  return new Error(problemMessage(await getProblemDetails(response)));
}

/** The games being played right now, strongest first. */
export async function listLiveGames(): Promise<LiveGame[]> {
  const response = await apiClient.games.live.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { games } = await response.json();
  return games;
}

export async function fetchSpectatorGame(id: string): Promise<SpectatorGame> {
  const response = await apiClient.games[":id"].watch.$get({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}
