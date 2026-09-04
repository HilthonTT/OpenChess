export const PROBLEM_JSON_MEDIA_TYPE = "application/problem+json";

export const ProblemType = {
  BLANK: "about:blank",
  VALIDATION_ERROR: "/problems/validation-error",
} as const;

export type ValidationIssue = {
  path: string;
  message: string;
  code?: string;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: ValidationIssue[];
  stack?: string;
};

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
