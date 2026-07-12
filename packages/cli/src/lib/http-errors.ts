import {
  ProblemType,
  isProblemDetails,
  type ProblemDetails,
} from "@openchess/shared";

type ErrorResponse = {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
};

/**
 * Read an error response as the problem the server promises to send. A crash or
 * a proxy in front of it can still answer with something else entirely, so a
 * body that isn't a problem is discarded rather than trusted, and the status
 * line stands in for it.
 */
export async function getProblemDetails(
  response: ErrorResponse,
): Promise<ProblemDetails> {
  try {
    const body: unknown = await response.json();
    if (isProblemDetails(body)) {
      return body;
    }
  } catch {
    // Not JSON at all; fall back to the status line below.
  }

  return {
    type: ProblemType.BLANK,
    title: response.statusText || "Error",
    status: response.status,
  };
}
