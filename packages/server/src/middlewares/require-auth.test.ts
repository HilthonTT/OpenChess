import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";
import * as HttpStatusCodes from "stoker/http-status-codes";

import type { AuthResult } from "../lib/auth";
import { onError } from "../lib/problem-details";
// Type-only: it does not evaluate the module, so it is safe alongside mock.module.
import type { AuthenticatedEnv } from "./require-auth";

/**
 * Stand in for Clerk. The middleware's whole job is mapping an `AuthResult` onto
 * a status and a challenge header, so the verifier is exactly the right seam to
 * fake: it keeps the test off the network, and it reaches failure modes (Clerk
 * down, bad secret key) that a real client could not produce on demand.
 */
let nextResult: AuthResult;

mock.module("../lib/auth", () => ({
  authenticateOAuthRequest: async () => nextResult,
}));

const { requireAuth, requireScopes } = await import("./require-auth");

function request(path: string) {
  const app = new Hono<AuthenticatedEnv>();

  // `onError` is written against AppBindings, whose Variables are a subset of
  // these; Hono's Env generic is invariant, so the widening needs a cast.
  app.onError(onError as unknown as Parameters<typeof app.onError>[0]);

  app.get("/me", requireAuth, (c) => c.json({ userId: c.get("userId") }));

  app.get("/write", requireAuth, requireScopes("games:write"), (c) =>
    c.json({ scopes: c.get("auth").scopes }),
  );

  return app.request(path);
}

function signedIn(...scopes: string[]): AuthResult {
  return {
    ok: true,
    actor: {
      userId: "user_123",
      clientId: "client_abc",
      tokenId: "oat_1",
      scopes,
    },
  };
}

function rejected(
  fault: "client" | "server",
  reason: string,
  message = "",
): AuthResult {
  return { ok: false, fault, reason, message };
}

describe("requireAuth", () => {
  test("passes a verified caller through to the handler", async () => {
    nextResult = signedIn("games:read");

    const response = await request("/me");

    expect(response.status).toBe(HttpStatusCodes.OK);
    expect(await response.json()).toEqual({ userId: "user_123" });
  });

  test("challenges a request that carries no token", async () => {
    nextResult = rejected("client", "no-token");

    const response = await request("/me");

    expect(response.status).toBe(HttpStatusCodes.UNAUTHORIZED);

    // No `error` on a missing token, per RFC 6750 §3: the caller is not being
    // told its token is bad, it is being told how to authenticate at all.
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer realm="openchess"',
    );
  });

  test("marks a rejected token invalid_token, so the client knows to refresh", async () => {
    nextResult = rejected("client", "token-invalid", "expired");

    const response = await request("/me");

    expect(response.status).toBe(HttpStatusCodes.UNAUTHORIZED);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="invalid_token"',
    );
  });

  test("does not tell the caller why the token was rejected", async () => {
    nextResult = rejected(
      "client",
      "client-id-mismatch",
      "Token was issued to OAuth client client_evil",
    );

    const body = await (await request("/me")).text();

    // Distinguishing "expired" from "issued to another app" hands an attacker an
    // oracle. The specifics belong in the log, not the response.
    expect(body).not.toContain("client_evil");
    expect(body).not.toContain("client-id-mismatch");
  });

  test("reports an outage as 503, not a 401 telling the user to log in again", async () => {
    nextResult = rejected(
      "server",
      "token-verification-failed",
      "connect ECONNREFUSED",
    );

    const response = await request("/me");

    expect(response.status).toBe(HttpStatusCodes.SERVICE_UNAVAILABLE);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  test("treats a bad secret key as our fault, not the caller's", async () => {
    nextResult = rejected("server", "secret-key-invalid");

    const response = await request("/me");

    expect(response.status).toBe(HttpStatusCodes.SERVICE_UNAVAILABLE);
  });
});

describe("requireScopes", () => {
  test("admits a token carrying every required scope", async () => {
    nextResult = signedIn("games:read", "games:write");

    const response = await request("/write");

    expect(response.status).toBe(HttpStatusCodes.OK);
  });

  test("forbids a token missing the scope instead of asking it to re-login", async () => {
    nextResult = signedIn("games:read");

    const response = await request("/write");

    // 403, not 401: re-authenticating cannot add a scope the user never granted.
    expect(response.status).toBe(HttpStatusCodes.FORBIDDEN);

    const challenge = response.headers.get("www-authenticate")!;

    expect(challenge).toContain('error="insufficient_scope"');
    expect(challenge).toContain('scope="games:write"');
  });
});
