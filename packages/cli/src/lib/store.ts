import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { responseError } from "./http-errors";

export type TitleCatalog = InferResponseType<typeof apiClient.titles.$get, 200>;
export type Title = TitleCatalog["titles"][number];

export type Purchase = InferResponseType<
  (typeof apiClient.titles)[":id"]["purchase"]["$post"],
  200
>;

export async function fetchTitles(): Promise<TitleCatalog> {
  const response = await apiClient.titles.$get();

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}

export async function purchaseTitle(id: string): Promise<Purchase> {
  const response = await apiClient.titles[":id"].purchase.$post({
    param: { id },
  });

  if (response.status !== 200) {
    throw await responseError(response);
  }

  return response.json();
}
