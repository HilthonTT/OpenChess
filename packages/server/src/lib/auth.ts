import env from "../env";
import { clerkClient } from "./clerk";

export interface AuthenticatedActor {
  userId: string;
  clientId: string;
  tokenId: string;
  scopes: string[];
}

export type AuthFailure = {
  ok: false;
  fault: "client" | "server";
  reason: string;
  message: string;
};

export type AuthResult = { ok: true; actor: AuthenticatedActor } | AuthFailure;

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

function verifyToken(request: Request) {
  return clerkClient.authenticateRequest(request, {
    acceptsToken: "oauth_token",
  });
}

export async function authenticateOAuthRequest(
  request: Request,
): Promise<AuthResult> {
  const header = request.headers.get("authorization");
  if (!header || !BEARER_TOKEN.test(header)) {
    return failure("client", "no-token", "No bearer token on the request");
  }

  let requestState: Awaited<ReturnType<typeof verifyToken>>;

  try {
    requestState = await verifyToken(request);
  } catch (error) {
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
