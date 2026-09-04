import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

export type PublicProfile = InferResponseType<
  (typeof apiClient.players)[":username"]["$get"],
  200
>;
export type ProfileGame = PublicProfile["recentGames"][number];
export type PlayerSearchResult = InferResponseType<
  typeof apiClient.players.$get,
  200
>["players"][number];

export async function fetchPlayerProfile(
  username: string,
): Promise<PublicProfile> {
  const response = await apiClient.players[":username"].$get({
    param: { username },
  });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

export async function searchPlayers(
  query: string,
): Promise<PlayerSearchResult[]> {
  const trimmed = query.trim();

  if (trimmed === "") {
    return [];
  }

  const response = await apiClient.players.$get({ query: { q: trimmed } });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  const { players } = await response.json();
  return players;
}
