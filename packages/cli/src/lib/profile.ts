import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { getProblemDetails } from "./http-errors";

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

export async function fetchProfile(): Promise<Profile> {
  const response = await apiClient.me.$get();

  if (response.status !== 200) {
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
  }

  return response.json();
}

export async function fetchStats(): Promise<PlayerStats> {
  const response = await apiClient.me.stats.$get();

  if (response.status !== 200) {
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
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
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
  }

  return response.json();
}

/** Pass null to display no title at all. Returns the updated profile. */
export async function equipTitle(titleId: string | null): Promise<Profile> {
  const response = await apiClient.me.title.$put({ json: { titleId } });

  if (response.status !== 200) {
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
  }

  return response.json();
}
