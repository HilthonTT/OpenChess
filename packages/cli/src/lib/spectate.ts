import type { InferResponseType } from "hono/client";
import type { ChatPhraseId } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Watching games you are not playing in.
 *
 * The spectator view is a different shape from a player's — no colour of your
 * own, no legal moves — which is the point: there is nothing here a watcher
 * could act on, so the screen built from it cannot accidentally offer to.
 *
 * The one thing a watcher can do is talk to the other watchers. That is a
 * channel of its own, with its own phrases: nothing said in it reaches either
 * player, and nothing the two of them say to each other appears in it.
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

export type SpectatorChatMessage = SpectatorGame["chat"][number];

/**
 * Say one of the watchers' phrases to the other watchers.
 *
 * The wire carries the phrase's key and never any text of ours, exactly as the
 * players' channel does — which is what keeps an open gallery a feature rather
 * than a moderation problem. Returns the recent transcript with the new message
 * on the end; everyone else watching gets the same over their stream.
 */
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
