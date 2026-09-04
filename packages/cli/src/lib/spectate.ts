import type { InferResponseType } from "hono/client";
import type { ChatPhraseId } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

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

export type SpectatorChatMessage = SpectatorGame["chat"][number];

export async function sendSpectatorChatMessage(
  id: string,
  phrase: ChatPhraseId,
): Promise<SpectatorChatMessage[]> {
  const response = await apiClient.games[":id"].watch.chat.$post({
    param: { id },
    json: { phrase },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { chat } = await response.json();
  return chat;
}
