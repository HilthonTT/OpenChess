import * as Sentry from "@sentry/hono/bun";
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

export {
  PROBLEM_JSON_MEDIA_TYPE,
  ProblemType,
  type ProblemDetails,
  type ValidationIssue,
};

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
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.array(validationIssueSchema).optional(),
    stack: z.string().optional(),
  })
  .openapi("ProblemDetails");

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

true satisfies Exactly<z.infer<typeof problemDetailsSchema>, ProblemDetails>;
true satisfies Exactly<z.infer<typeof validationIssueSchema>, ValidationIssue>;

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

export function createProblemDetails(input: ProblemInput): ProblemDetails {
  const { status, type = ProblemType.BLANK, title, ...rest } = input;

  return {
    type,
    title: title ?? phraseForStatus(status),
    status,
    ...rest,
  };
}

export function problemResponse(c: Context, problem: ProblemDetails) {
  return c.body(
    JSON.stringify(problem),
    problem.status as ContentfulStatusCode,
    {
      "content-type": PROBLEM_JSON_MEDIA_TYPE,
    },
  );
}

export function problemFor(c: Context, input: ProblemInput): ProblemDetails {
  return createProblemDetails({
    instance: c.req.path,
    requestId: c.get("requestId"),
    ...input,
  });
}

export function throwProblem(
  status: ContentfulStatusCode,
  detail?: string,
): never {
  throw new HTTPException(status, {
    message: detail ?? phraseForStatus(status),
  });
}

export function problemFromError(
  error: Error,
  options: { debug: boolean },
): ProblemInput {
  if (error instanceof HTTPException) {
    return {
      status: error.status,
      detail: error.message || phraseForStatus(error.status),
    };
  }

  const status = HttpStatusCodes.INTERNAL_SERVER_ERROR;
  if (!options.debug) {
    return { status, detail: phraseForStatus(status) };
  }

  return { status, detail: error.message, stack: error.stack };
}

function reportToSentry(c: Context, error: Error) {
  Sentry.captureException(error, {
    mechanism: {
      type: "hono.on_error",
      handled: error instanceof HTTPException,
    },
    captureContext: {
      tags: { request_id: c.get("requestId") },
    },
  });
}

export const onError: ErrorHandler<AppBindings> = (error, c) => {
  if (error instanceof HTTPException && error.res) {
    return error.res;
  }

  const debug = env.NODE_ENV !== "production";
  const input = problemFromError(error, { debug });

  if (input.status >= HttpStatusCodes.INTERNAL_SERVER_ERROR) {
    c.var.logger?.error({ err: error }, "Unhandled error");
    reportToSentry(c, error);
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
