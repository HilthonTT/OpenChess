import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { createRouter } from "../lib/create-app";
import {
  problemDetailsContent,
  problemFor,
  problemResponse,
} from "../lib/problem-details";
import { TAGS } from "./tags";

const base = createRouter();

const MAX_STATE_LENGTH = 512;

const LOOPBACK_HOST = "127.0.0.1";

const stateSchema = z.object({
  port: z.number().int().min(1024).max(65535),
});

const callbackQuerySchema = z.object({
  code: z.string().optional().openapi({
    description: "Authorization code from the provider.",
    example: "ac_9f2b…",
  }),
  state: z.string().optional().openapi({
    description:
      "Opaque state, encodes the loopback port the CLI is listening on.",
  }),
  error: z.string().optional().openapi({
    description: "Set instead of `code` when the provider rejects the request.",
    example: "access_denied",
  }),
  error_description: z.string().optional().openapi({
    description:
      "Human-readable detail from the provider. Logged, never echoed.",
  }),
});

const OAUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  "invalid_request",
  "unauthorized_client",
  "access_denied",
  "unsupported_response_type",
  "invalid_scope",
  "server_error",
  "temporarily_unavailable",
]);

/**
 * Recover the CLI's callback port from the `state`.
 *
 * Returns `null` on anything malformed rather than throwing, so a hostile
 * `state` is an ordinary 400 and not a 500 with a stack trace.
 */
export function portFromState(state: string): number | null {
  if (state.length > MAX_STATE_LENGTH) {
    return null;
  }

  // The CLI sends a single base64url JSON payload. Taking the first
  // dot-segment keeps us working if a signed `payload.signature` format ever
  // replaces it.
  const [encoded] = state.split(".");
  if (!encoded) {
    return null;
  }

  let payload: unknown;
  try {
    // `Buffer.from(.., "base64url")` never throws — it silently drops invalid
    // characters — so JSON.parse is what actually rejects garbage here.
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const parsed = stateSchema.safeParse(payload);

  return parsed.success ? parsed.data.port : null;
}

const callback = createRoute({
  tags: [TAGS.AUTH],
  method: "get",
  path: "/callback",
  summary: "OAuth redirect target",
  description:
    "The URI registered with the provider. Validates the state, then bounces the code back to the loopback listener the CLI opened. Never renders anything itself.",
  request: { query: callbackQuerySchema },
  responses: {
    [HttpStatusCodes.MOVED_TEMPORARILY]: {
      description: "Code and state forwarded to the local listener",
      headers: z.object({
        Location: z.string().url().openapi({
          example: "http://127.0.0.1:51337/callback?code=ac_9f2b&state=…",
        }),
      }),
    },
    [HttpStatusCodes.BAD_REQUEST]: problemDetailsContent(
      "Provider error, missing code or state, or unparseable state",
    ),
  },
});

const router = base.openapi(callback, async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  const badRequest = (detail: string) =>
    problemResponse(
      c,
      problemFor(c, { status: HttpStatusCodes.BAD_REQUEST, detail }),
    );

  if (error) {
    c.var.logger?.warn(
      { error, description: c.req.query("error_description") },
      "OAuth provider returned an error",
    );

    const safeCode = OAUTH_ERROR_CODES.has(error) ? error : "invalid_request";

    return badRequest(
      `The authorization server rejected the request: ${safeCode}`,
    );
  }

  if (!code || !state) {
    return badRequest("Missing authorization code or state");
  }

  const port = portFromState(state);
  if (port === null) {
    // The state is attacker-supplied and can be arbitrarily long; log enough
    // to recognize it, not enough to let a caller stuff the logs.
    c.var.logger?.warn(
      { state: state.slice(0, 128) },
      "Rejected malformed OAuth state",
    );

    return badRequest("Invalid authentication state");
  }

  const redirectUrl = new URL(`http://${LOOPBACK_HOST}:${port}/callback`);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", state);

  return c.redirect(redirectUrl.toString(), HttpStatusCodes.MOVED_TEMPORARILY);
});

export default router;
