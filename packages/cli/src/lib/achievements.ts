import type { InferResponseType } from "hono";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

export type AchievementPage = InferResponseType<
  typeof apiClient.achievements.$get,
  200
>;

export type AchievementEntry = AchievementPage["achievements"][number];

export async function fetchAchievements(): Promise<AchievementPage> {
  const response = await apiClient.achievements.$get();

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}
