import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

/**
 * Typed calls to the server's `/players` API — other people's profiles, and
 * finding them by name. Like the `/me` helpers, every call either returns the
 * decoded body or throws an `Error` carrying the server's problem detail.
 */

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

/**
 * Players whose name starts with `query`, capped by the server at ten.
 *
 * An empty query returns nothing rather than everyone, so a search box can call
 * this on every keystroke without a special case for the first one.
 */
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
