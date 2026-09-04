import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

export type Profile = InferResponseType<typeof apiClient.me.$get, 200>;
export type PlayerStats = InferResponseType<
  typeof apiClient.me.stats.$get,
  200
>;
export type CheckIn = InferResponseType<
  (typeof apiClient.me)["check-in"]["$post"],
  200
>;
export type RatingHistory = InferResponseType<
  (typeof apiClient.me)["rating-history"]["$get"],
  200
>;

export async function fetchProfile(): Promise<Profile> {
  const response = await apiClient.me.$get();

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

export async function fetchStats(): Promise<PlayerStats> {
  const response = await apiClient.me.stats.$get();

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

export async function fetchRatingHistory(
  limit?: number,
): Promise<RatingHistory> {
  const response = await apiClient.me["rating-history"].$get({
    query: limit === undefined ? {} : { limit: String(limit) },
  });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

export async function checkIn(): Promise<CheckIn> {
  const response = await apiClient.me["check-in"].$post();

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

export async function equipTitle(titleId: string | null): Promise<Profile> {
  const response = await apiClient.me.title.$put({ json: { titleId } });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}
