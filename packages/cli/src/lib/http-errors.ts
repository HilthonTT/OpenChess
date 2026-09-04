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

export async function getProblemDetails(
  response: ErrorResponse,
): Promise<ProblemDetails> {
  try {
    const body: unknown = await response.json();
    if (isProblemDetails(body)) {
      return body;
    }
  } catch {}

  return {
    type: ProblemType.BLANK,
    title: response.statusText || "Error",
    status: response.status,
  };
}

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

export async function responseError(response: ErrorResponse): Promise<Error> {
  return new Error(problemMessage(await getProblemDetails(response)));
}
