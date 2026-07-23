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

/**
 * The screen-ready sentence for a problem. `detail` over `title` (the RFC
 * makes `detail` the human explanation), field-level validation issues spelled
 * out so a 400 says which field, and — on server faults only — the request id,
 * which is the one token that lets a bug report be matched to a log line.
 */
export function problemMessage(problem: ProblemDetails): string {
  const parts: string[] = [problem.detail ?? problem.title];

  if (problem.errors && problem.errors.length > 0) {
    parts.push(
      problem.errors
        .map((issue) =>
          issue.path ? `${issue.path}: ${issue.message}` : issue.message,
        )
        .join("; "),
    );
  }

  if (problem.status >= 500 && problem.requestId) {
    parts.push(`(ref ${problem.requestId})`);
  }

  return parts.join(" — ");
}

/**
 * The standard "response refused" error: reads the problem off the response
 * and wraps its screen-ready message in an `Error`, so API helpers can
 * `throw await responseError(response)` and screens can show `error.message`
 * as-is.
 */
export async function responseError(response: ErrorResponse): Promise<Error> {
  return new Error(problemMessage(await getProblemDetails(response)));
}
