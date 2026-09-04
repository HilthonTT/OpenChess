import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

export type LeaderboardPage = InferResponseType<
  typeof apiClient.leaderboard.$get,
  200
>;
export type LeaderboardEntry = LeaderboardPage["entries"][number];

export const SORTS = ["rating", "level", "wins"] as const;
export type LeaderboardSort = (typeof SORTS)[number];

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
