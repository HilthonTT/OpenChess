import type { InferResponseType } from "hono/client";
import type { Color } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

const byId = apiClient.repertoire[":id"];

export type RepertoireLine = InferResponseType<
  typeof apiClient.repertoire.$get,
  200
>["lines"][number];

export type RepertoireReviewResult = InferResponseType<
  (typeof byId.review)["$post"],
  200
>;

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  return new Error(problemMessage(await getProblemDetails(response)));
}

export async function fetchRepertoire(): Promise<RepertoireLine[]> {
  const response = await apiClient.repertoire.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { lines } = await response.json();
  return lines;
}

export async function fetchNextDueLine(): Promise<RepertoireLine | null> {
  const response = await apiClient.repertoire.next.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { line } = await response.json();
  return line;
}

export async function addRepertoireLine(input: {
  eco: string;
  name: string;
  moves: string[];
  side: Color;
}): Promise<{ line: RepertoireLine; added: boolean }> {
  const response = await apiClient.repertoire.$post({ json: input });

  if (response.status !== 201) {
    throw await toError(response);
  }

  return response.json();
}

export async function removeRepertoireLine(id: string): Promise<void> {
  const response = await byId.$delete({ param: { id } });

  if (response.status !== 204) {
    throw await toError(response);
  }
}

export async function reviewRepertoireLine(
  id: string,
  input: { mistakes: number; msSpent?: number },
): Promise<RepertoireReviewResult> {
  const response = await byId.review.$post({ param: { id }, json: input });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}
