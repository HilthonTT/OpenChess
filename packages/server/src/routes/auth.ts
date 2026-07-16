import { z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { createRouter } from "../lib/create-app";
import { problemFor, problemResponse } from "../lib/problem-details";

const MAX_STATE_LENGTH = 512;

const LOOPBACK_HOST = "127.0.0.1";

const stateSchema = z.object({
  port: z.number().int().min(1024).max(65535),
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

const router = createRouter().get("/callback", (c) => {
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
