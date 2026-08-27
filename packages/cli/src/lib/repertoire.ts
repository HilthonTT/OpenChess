import type { InferResponseType } from "hono/client";
import type { Color } from "@openchess/shared";
import { apiClient } from "./api-client";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Typed calls to the server's `/repertoire` API.
 *
 * The lines are yours and the schedule is the server's: what is due, when it
 * next falls due, and what a review paid are all decided there, so this module
 * sends what happened in the drill and renders what comes back. The one thing
 * the client computes for itself is the drill — replaying the line locally, off
 * the SAN the server stored — because a move-by-move round trip would make an
 * opening drill feel like a correspondence game.
 */

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

/** Every line you keep, soonest due first. */
export async function fetchRepertoire(): Promise<RepertoireLine[]> {
  const response = await apiClient.repertoire.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { lines } = await response.json();
  return lines;
}

/** The line to drill next, or null when nothing is due. */
export async function fetchNextDueLine(): Promise<RepertoireLine | null> {
  const response = await apiClient.repertoire.next.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  const { line } = await response.json();
  return line;
}

/**
 * Keep a line, due immediately.
 *
 * `moves` is SAN from the initial array — the form the book is written in, so
 * a line walked in the explorer is sent exactly as it was walked. `added` is
 * false when you already kept it, which is not an error: pressing the key twice
 * on the same line means the same thing both times.
 */
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

/** Drop a line from the repertoire and from the queue. */
export async function removeRepertoireLine(id: string): Promise<void> {
  const response = await byId.$delete({ param: { id } });

  if (response.status !== 204) {
    throw await toError(response);
  }
}

/**
 * Report a drill and reschedule the line.
 *
 * `mistakes` is how many of your own moves you got wrong; one is enough to fail
 * the line. A drill of a line that was not due reschedules it just the same and
 * pays nothing, which is why `reward` can come back null on a clean run.
 */
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
