import type { InferResponseType } from "hono";
import { apiClient } from "./api-client";
import { getProblemDetails } from "./http-errors";

export type AchievementPage = InferResponseType<
  typeof apiClient.achievements.$get,
  200
>;

export type AchievementEntry = AchievementPage["achievements"][number];

export async function fetchAchievements(): Promise<AchievementPage> {
  const response = await apiClient.achievements.$get();

  if (response.status !== 200) {
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
  }

  return response.json();
}
