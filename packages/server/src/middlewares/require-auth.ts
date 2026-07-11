import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { authenticateOAuthRequest } from "../lib/auth";
import type { AuthFailure, AuthenticatedActor } from "../lib/auth";
import {
  problemFor,
  problemResponse,
  throwProblem,
} from "../lib/problem-details";
import type { AppBindings } from "../lib/types";

/** Routes behind `requireAuth` can read the verified caller off the context. */
export type AuthenticatedEnv = {
  Variables: AppBindings["Variables"] & {
    auth: AuthenticatedActor;
    /** Shorthand for `c.get("auth").userId`, which handlers reach for constantly. */
    userId: string;
  };
};

const REALM = "openchess";

function challenge(params: Record<string, string | undefined>): string {
  const parts = Object.entries({ realm: REALM, ...params })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${value!.replace(/["\\]/g, "")}"`);

  return `Bearer ${parts.join(", ")}`;
}

function unauthorized(c: Context, failure: AuthFailure) {
  c.header(
    "WWW-Authenticate",
    challenge({
      error: failure.reason === "no-token" ? undefined : "invalid_token",
    }),
  );

  return problemResponse(
    c,
    problemFor(c, {
      status: HttpStatusCodes.UNAUTHORIZED,
      detail: "Unauthorized. Login to continue.",
    }),
  );
}

export const requireAuth = createMiddleware<AuthenticatedEnv>(
  async (c, next) => {
    const result = await authenticateOAuthRequest(c.req.raw);

    if (!result.ok) {
      c.var.logger?.warn(
        { fault: result.fault, reason: result.reason, msg: result.message },
        "Authentication failed",
      );

      if (result.fault === "server") {
        throwProblem(
          HttpStatusCodes.SERVICE_UNAVAILABLE,
          "Authentication is temporarily unavailable. Try again shortly.",
        );
      }

      return unauthorized(c, result);
    }

    c.set("auth", result.actor);
    c.set("userId", result.actor.userId);

    await next();
  },
);

export function requireScopes(...required: string[]) {
  return createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const granted = new Set(c.get("auth").scopes);
    const missing = required.filter((scope) => !granted.has(scope));

    if (missing.length > 0) {
      c.var.logger?.warn(
        { userId: c.get("userId"), missing },
        "Insufficient scope",
      );

      c.header(
        "WWW-Authenticate",
        challenge({
          error: "insufficient_scope",
          scope: required.join(" "),
        }),
      );

      return problemResponse(
        c,
        problemFor(c, {
          status: HttpStatusCodes.FORBIDDEN,
          detail: `This token is missing the required scope: ${missing.join(", ")}`,
        }),
      );
    }

    await next();
  });
}
