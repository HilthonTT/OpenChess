/**
 * Error responses follow RFC 9457 (Problem Details for HTTP APIs). Every
 * response with an unsuccessful status carries this shape, so clients can parse
 * one thing instead of guessing per endpoint.
 *
 * This module is the contract between the two sides and deliberately nothing
 * else: no zod, no HTTP framework, no server internals. Serving a problem —
 * building one from a request, rendering it, describing it to OpenAPI — belongs
 * to the server, and lives in its `lib/problem-details`.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */
export const PROBLEM_JSON_MEDIA_TYPE = "application/problem+json";

/** `type` values we mint ourselves. `about:blank` means "just the status code". */
export const ProblemType = {
  BLANK: "about:blank",
  VALIDATION_ERROR: "/problems/validation-error",
} as const;

export type ValidationIssue = {
  /** Dotted path to the offending field, empty for the root value. */
  path: string;
  message: string;
  code?: string;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  /** The request URI this problem occurred for. */
  instance?: string;
  /** Correlates the response with the server log line. */
  requestId?: string;
  /** Present on validation failures. */
  errors?: ValidationIssue[];
  /** Non-production only: the stack of an unhandled error. */
  stack?: string;
};

/**
 * Whether a decoded response body is a problem.
 *
 * Only the three members RFC 9457 requires are checked. A caller reaches for
 * this to decide whether it can report the body instead of the bare status, and
 * a payload carrying those three answers that question; the optional members are
 * read off it as they come.
 */
export function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.status === "number"
  );
}
