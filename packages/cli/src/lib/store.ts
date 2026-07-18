import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { getProblemDetails } from "./http-errors";

/**
 * Typed calls to the server's `/titles` store API. Like the `/games` helpers,
 * every call either returns the decoded body or throws an `Error` carrying the
 * server's problem detail, so screens can render `error.message` as-is.
 */

export type TitleCatalog = InferResponseType<typeof apiClient.titles.$get, 200>;
export type Title = TitleCatalog["titles"][number];

export type Purchase = InferResponseType<
  (typeof apiClient.titles)[":id"]["purchase"]["$post"],
  200
>;

export async function fetchTitles(): Promise<TitleCatalog> {
  const response = await apiClient.titles.$get();

  if (response.status !== 200) {
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
  }

  return response.json();
}

export async function purchaseTitle(id: string): Promise<Purchase> {
  const response = await apiClient.titles[":id"].purchase.$post({
    param: { id },
  });

  if (response.status !== 200) {
    const problem = await getProblemDetails(response);
    throw new Error(problem.detail ?? problem.title);
  }

  return response.json();
}
