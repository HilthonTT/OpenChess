import { z } from "@hono/zod-openapi";
import type { Hook } from "@hono/zod-openapi";
import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as HttpStatusCodes from "stoker/http-status-codes";
import * as HttpStatusPhrases from "stoker/http-status-phrases";
import {
  PROBLEM_JSON_MEDIA_TYPE,
  ProblemType,
  type ProblemDetails,
  type ValidationIssue,
} from "@openchess/shared";

import env from "../env";
import type { AppBindings } from "./types";

/**
 * Serving RFC 9457 problems.
 *
 * The shape itself is the API's contract with its clients, so it lives in
 * `@openchess/shared` and the CLI reads the very same definition; this module is
 * the server's half — turning a failure into a problem, rendering it, and
 * describing it to OpenAPI. Re-exported so server code has one import site.
 *
 * @see https://www.rfc-editor.org/rfc/rfc9457
 */
export {
  PROBLEM_JSON_MEDIA_TYPE,
  ProblemType,
  type ProblemDetails,
  type ValidationIssue,
};

/**
 * `stoker` exports status codes and reason phrases as parallel modules keyed by
 * the same names (`NOT_FOUND` -> 404 / "Not Found"), so we can join them into
 * the code -> phrase lookup that RFC 9457's `title` wants.
 */
const PHRASE_BY_STATUS: ReadonlyMap<number, string> = new Map(
  Object.entries(HttpStatusCodes).flatMap(([name, status]) => {
    const phrase = (HttpStatusPhrases as Record<string, string | undefined>)[
      name
    ];
    return typeof status === "number" && phrase
      ? [[status, phrase] as const]
      : [];
  }),
);

export function phraseForStatus(status: number): string {
  return PHRASE_BY_STATUS.get(status) ?? "Error";
}

export const validationIssueSchema = z
  .object({
    /** Dotted path to the offending field, empty for the root value. */
    path: z.string(),
    message: z.string(),
    code: z.string().optional(),
  })
  .openapi("ValidationIssue");

export const problemDetailsSchema = z
  .object({
    type: z.string().openapi({ example: ProblemType.BLANK }),
    title: z.string().openapi({ example: HttpStatusPhrases.NOT_FOUND }),
    status: z.number().int().openapi({ example: HttpStatusCodes.NOT_FOUND }),
    detail: z.string().optional(),
    /** The request URI this problem occurred for. */
    instance: z.string().optional(),
    /** Correlates the response with the server log line. */
    requestId: z.string().optional(),
    /** Present on validation failures. */
    errors: z.array(validationIssueSchema).optional(),
    /** Non-production only: the stack of an unhandled error. */
    stack: z.string().optional(),
  })
  .openapi("ProblemDetails");

/**
 * The schema describes what we serve; `ProblemDetails` describes what the CLI
 * parses. Those have to be the same thing, so pin them to each other: a member
 * added to one and not the other stops compiling rather than quietly shipping an
 * API the client can't read.
 *
 * The schema can't simply be built from the shared type — it carries OpenAPI
 * metadata, which would drag `@hono/zod-openapi` into every client that only
 * wanted to read an error.
 */
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

true satisfies Exactly<z.infer<typeof problemDetailsSchema>, ProblemDetails>;
true satisfies Exactly<z.infer<typeof validationIssueSchema>, ValidationIssue>;

/** Describes a problem+json response body in an OpenAPI route definition. */
export function problemDetailsContent(description: string) {
  return {
    description,
    content: {
      [PROBLEM_JSON_MEDIA_TYPE]: { schema: problemDetailsSchema },
    },
  };
}

type ProblemInput = Omit<ProblemDetails, "type" | "title" | "status"> &
  Partial<Pick<ProblemDetails, "type" | "title">> & {
    status: ContentfulStatusCode;
  };

/** Fill in the members RFC 9457 lets us default: `type` and `title`. */
export function createProblemDetails(input: ProblemInput): ProblemDetails {
  const { status, type = ProblemType.BLANK, title, ...rest } = input;

  return {
    type,
    title: title ?? phraseForStatus(status),
    status,
    ...rest,
  };
}

/**
 * Serialize a problem. `c.json` would force `application/json`, and the whole
 * point of the RFC is the `application/problem+json` content type.
 */
export function problemResponse(c: Context, problem: ProblemDetails) {
  return c.body(
    JSON.stringify(problem),
    problem.status as ContentfulStatusCode,
    {
      "content-type": PROBLEM_JSON_MEDIA_TYPE,
    },
  );
}

/** Build a problem from the request context, stamping `instance` and `requestId`. */
export function problemFor(c: Context, input: ProblemInput): ProblemDetails {
  return createProblemDetails({
    instance: c.req.path,
    requestId: c.get("requestId"),
    ...input,
  });
}

/** Raise an HTTP error from a handler; `onError` renders it as problem+json. */
export function throwProblem(
  status: ContentfulStatusCode,
  detail?: string,
): never {
  throw new HTTPException(status, {
    message: detail ?? phraseForStatus(status),
  });
}

/**
 * Translate a thrown value into a problem.
 *
 * An `HTTPException` is a deliberate, client-facing error, so its message
 * becomes the `detail`. Anything else escaped by accident: it gets a bare 500,
 * and its message and stack are withheld outside development so an internal
 * failure can't leak table names or file paths to a caller.
 */
export function problemFromError(
  error: Error,
  options: { debug: boolean },
): ProblemInput {
  if (error instanceof HTTPException) {
    return {
      status: error.status,
      // HTTPException defaults `message` to the empty string, not the phrase.
      detail: error.message || phraseForStatus(error.status),
    };
  }

  const status = HttpStatusCodes.INTERNAL_SERVER_ERROR;
  if (!options.debug) {
    return { status, detail: phraseForStatus(status) };
  }

  return { status, detail: error.message, stack: error.stack };
}

export const onError: ErrorHandler<AppBindings> = (error, c) => {
  // An HTTPException may carry a hand-built response; honor it rather than
  // overwriting a deliberate redirect or custom body.
  if (error instanceof HTTPException && error.res) {
    return error.res;
  }

  const debug = env.NODE_ENV !== "production";
  const input = problemFromError(error, { debug });

  if (input.status >= HttpStatusCodes.INTERNAL_SERVER_ERROR) {
    c.var.logger?.error({ err: error }, "Unhandled error");
  }

  return problemResponse(c, problemFor(c, input));
};

export const notFound: NotFoundHandler<AppBindings> = (c) => {
  return problemResponse(
    c,
    problemFor(c, {
      status: HttpStatusCodes.NOT_FOUND,
      detail: `No route matched ${c.req.method} ${c.req.path}`,
    }),
  );
};

/**
 * Renders `@hono/zod-openapi` validation failures as a problem, listing every
 * offending field under the `errors` extension member rather than surfacing
 * only the first issue.
 */
export const defaultHook: Hook<unknown, AppBindings, string, unknown> = (
  result,
  c,
) => {
  if (result.success) {
    return;
  }

  const errors: ValidationIssue[] = result.error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
    code: issue.code,
  }));

  return problemResponse(
    c,
    problemFor(c, {
      type: ProblemType.VALIDATION_ERROR,
      status: HttpStatusCodes.UNPROCESSABLE_ENTITY,
      title: "Validation Failed",
      detail: `The ${result.target} does not match the expected schema`,
      errors,
    }),
  );
};
