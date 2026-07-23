import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

/**
 * Typed calls to the server's `/leaderboard` API. Like the `/games` helpers,
 * every call either returns the decoded body or throws an `Error` carrying the
 * server's problem detail, so screens can render `error.message` as-is.
 */

export type LeaderboardPage = InferResponseType<
  typeof apiClient.leaderboard.$get,
  200
>;
export type LeaderboardEntry = LeaderboardPage["entries"][number];

export const SORTS = ["rating", "level", "wins"] as const;
export type LeaderboardSort = (typeof SORTS)[number];

/**
 * The server rejects a page past this, because the page becomes an OFFSET and
 * no leaderboard anyone reads is ten thousand pages deep. Mirrored here so a
 * held-down arrow key stops at the last page instead of earning a 400.
 */
export const MAX_PAGE = 10_000;

export async function fetchLeaderboard(input: {
  sort: LeaderboardSort;
  page: number;
  limit: number;
}): Promise<LeaderboardPage> {
  const response = await apiClient.leaderboard.$get({
    query: {
      sort: input.sort,
      page: String(input.page),
      limit: String(input.limit),
    },
  });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}
