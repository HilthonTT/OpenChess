import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

/**
 * Typed calls to the server's `/me` API. Like the `/games` helpers, every call
 * either returns the decoded body or throws an `Error` carrying the server's
 * problem detail, so screens can render `error.message` as-is.
 */

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

/**
 * The rating curve, oldest point first. Only rated games that actually moved the
 * number are on it, so the points are changes rather than games.
 */
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

/**
 * Claim today's login streak. Idempotent per UTC day — the server pays at most
 * once and reports `claimed: false` on every later call — so the caller may fire
 * this on any sign-in without remembering whether it already did.
 */
export async function checkIn(): Promise<CheckIn> {
  const response = await apiClient.me["check-in"].$post();

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

/** Pass null to display no title at all. Returns the updated profile. */
export async function equipTitle(titleId: string | null): Promise<Profile> {
  const response = await apiClient.me.title.$put({ json: { titleId } });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}
