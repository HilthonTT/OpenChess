import env from "../env";
import { clerkClient } from "./clerk";

/**
 * The Clerk client itself lives in `lib/clerk` rather than here. This module's
 * exported surface is mocked wholesale in the middleware tests, so anything else
 * exported from it would vanish under that mock — see the note in `lib/clerk`.
 */

/** The caller behind a verified OAuth access token. */
export interface AuthenticatedActor {
  userId: string;
  /** The OAuth application the token was issued to. */
  clientId: string;
  /** Clerk's id for the access token itself; safe to log, unlike the token. */
  tokenId: string;
  /** Scopes granted at consent. Authorization decisions read these. */
  scopes: string[];
}

/**
 * `fault` is the whole point of this type. A token that is missing, expired, or
 * forged is the *caller's* problem and deserves a 401. A bad secret key or an
 * unreachable Clerk is *our* problem, and answering it with a 401 tells the user
 * to log in again for an outage they cannot fix — while hiding the incident from
 * our own error rate. The middleware maps the two to different statuses.
 */
export type AuthFailure = {
  ok: false;
  fault: "client" | "server";
  /** Machine-readable cause, from Clerk. Logged, never returned to the caller. */
  reason: string;
  message: string;
};

export type AuthResult = { ok: true; actor: AuthenticatedActor } | AuthFailure;

/**
 * Clerk reasons that mean verification could not be *completed*, as opposed to
 * completing with a "no". Everything else is a caller fault.
 *
 * `unexpected-error` only belongs here because `authenticateOAuthRequest` rejects
 * tokenless requests before Clerk ever sees them — see the note there. Clerk
 * reuses that one string for both "no Authorization header" and "verification
 * blew up", and treating the former as a server fault would 503 every anonymous
 * request.
 *
 * @see MachineTokenVerificationErrorCode in `@clerk/backend`
 */
const SERVER_FAULT_REASONS: ReadonlySet<string> = new Set([
  "secret-key-invalid",
  "token-verification-failed",
  "unexpected-error",
]);

const BEARER_TOKEN = /^Bearer\s+\S/i;

function failure(
  fault: AuthFailure["fault"],
  reason: string,
  message: string,
): AuthFailure {
  return { ok: false, fault, reason, message };
}

/** Isolated so its return type infers as `RequestState<"oauth_token">`. */
function verifyToken(request: Request) {
  return clerkClient.authenticateRequest(request, {
    acceptsToken: "oauth_token",
  });
}

/**
 * Verify the `Authorization: Bearer` OAuth access token on a request.
 *
 * Never throws: every outcome, including Clerk being down, comes back as a
 * value so callers cannot accidentally collapse an outage into a 401.
 */
export async function authenticateOAuthRequest(
  request: Request,
): Promise<AuthResult> {
  // Handle "no token at all" ourselves. Clerk answers a missing Authorization
  // header with reason `unexpected-error` — the very string that otherwise means
  // "Clerk fell over" — so letting it through here would make every anonymous
  // request look like an outage and earn a 503. Short-circuiting also spares us
  // a network round-trip on traffic that was never going to authenticate.
  const header = request.headers.get("authorization");
  if (!header || !BEARER_TOKEN.test(header)) {
    return failure("client", "no-token", "No bearer token on the request");
  }

  let requestState: Awaited<ReturnType<typeof verifyToken>>;

  try {
    requestState = await verifyToken(request);
  } catch (error) {
    // Clerk throws (rather than returning a verdict) when it cannot verify at
    // all — network failure, malformed secret key. That is on us.
    return failure(
      "server",
      "verification-threw",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!requestState.isAuthenticated) {
    const reason = requestState.reason ?? "unknown";
    return failure(
      SERVER_FAULT_REASONS.has(reason) ? "server" : "client",
      reason,
      requestState.message ?? "",
    );
  }

  const auth = requestState.toAuth();

  // `acceptsToken` already constrains this, but the auth object is a union over
  // every token type and only this branch carries `userId`/`clientId`/`scopes`.
  if (auth.tokenType !== "oauth_token") {
    return failure(
      "client",
      "token-type-mismatch",
      `Expected an oauth_token, got ${auth.tokenType}`,
    );
  }

  if (!auth.userId || !auth.clientId) {
    return failure(
      "client",
      "token-not-user-scoped",
      "Token carries no user or client identity",
    );
  }

  // A Clerk instance can host several OAuth applications, and every one of them
  // mints tokens this secret key will happily verify. Without this check, a user
  // consenting to some unrelated app would hand that app a token good against
  // our API — the classic confused deputy.
  if (
    env.CLERK_OAUTH_CLIENT_ID &&
    auth.clientId !== env.CLERK_OAUTH_CLIENT_ID
  ) {
    return failure(
      "client",
      "client-id-mismatch",
      `Token was issued to OAuth client ${auth.clientId}`,
    );
  }

  return {
    ok: true,
    actor: {
      userId: auth.userId,
      clientId: auth.clientId,
      tokenId: auth.id,
      scopes: auth.scopes ?? [],
    },
  };
}
