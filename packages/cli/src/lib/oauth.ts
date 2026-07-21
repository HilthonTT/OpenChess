import open from "open";
import { getAuth, saveAuth } from "./auth";
import { errorMessage } from "./utils";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

type OAuthState = {
  nonce: string;
  port: number;
};

function toBase64Url(input: Uint8Array | string) {
  return Buffer.from(input).toString("base64url");
}

async function createPkceChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}

function encodeState(state: OAuthState) {
  return toBase64Url(JSON.stringify(state));
}

/**
 * What Clerk's token endpoint answers with, for both the code exchange and a
 * refresh. Persist everything needed to renew the session without a browser:
 * the rotated refresh token (falling back to the one just spent, for providers
 * that only rotate sometimes) and an absolute expiry for proactive renewal.
 */
function saveTokenResponse(
  data: { access_token: string; refresh_token?: unknown; expires_in?: unknown },
  previousRefreshToken?: string,
) {
  saveAuth({
    token: data.access_token,
    refreshToken:
      typeof data.refresh_token === "string" && data.refresh_token.length > 0
        ? data.refresh_token
        : previousRefreshToken,
    expiresAt:
      typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000
        : undefined,
  });
}

// The state contract, shared with the server's `portFromState`: one base64url
// JSON payload carrying the nonce and callback port, nothing appended.
function decodeState(state: string) {
  return JSON.parse(Buffer.from(state, "base64url").toString()) as OAuthState;
}

export async function performLogin() {
  const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
  const clientId = process.env.CLERK_OAUTH_CLIENT_ID;
  // Must match api-client.ts: the same env var, the same default, and the
  // server mounts everything under /api — so the callback route is
  // `${apiUrl}/auth/callback`, i.e. /api/auth/callback by default.
  const apiUrl = process.env.API_URL ?? "http://localhost:3000/api";

  if (!clerkFrontendApi) {
    throw new Error("CLERK_FRONTEND_API not set");
  }
  if (!clientId) {
    throw new Error("CLERK_OAUTH_CLIENT_ID not set");
  }

  const nonce = crypto.randomUUID();
  const codeVerifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = await createPkceChallenge(codeVerifier);

  let settled = false;
  return new Promise<{ token: string }>((resolve, reject) => {
    const server = Bun.serve({
      // Bun binds 0.0.0.0 by default, which would put the server that receives
      // the authorization code on every network interface. Only the local
      // browser redirect ever needs to reach it.
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        // The flow only settles once. A browser retry or a duplicate redirect
        // arriving in the brief window before the server stops must not run a
        // second code exchange and overwrite the token we already saved.
        if (settled) {
          return new Response("Already handled. You can close this tab.", {
            status: 409,
          });
        }

        const error = url.searchParams.get("error");

        if (error) {
          const msg = url.searchParams.get("error_description") ?? error;
          settled = true;
          reject(new Error(msg));
          setTimeout(() => server.stop(), 500);
          return new Response(`Authentication failed: ${msg}`, { status: 400 });
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (!code || !state) {
          settled = true;
          reject(new Error("Missing code or state"));
          setTimeout(() => server.stop(), 500);
          return new Response("Bad request", { status: 400 });
        }

        // Verify nonce from state
        try {
          const payload = decodeState(state);

          if (payload.nonce !== nonce) throw new Error("State mismatch");
        } catch (err) {
          settled = true;
          reject(err);
          setTimeout(() => server.stop(), 500);
          return new Response("Invalid state", { status: 400 });
        }

        // Claim the flow before the first await: a duplicate redirect landing
        // mid-exchange must hit the `settled` guard above instead of running a
        // second exchange, and the timeout must not fire once we've started.
        settled = true;

        try {
          // Exchange authorization code for Clerk tokens
          const redirectUri = `${apiUrl}/auth/callback`;

          const tokenRes = await fetch(`${clerkFrontendApi}/oauth/token`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              redirect_uri: redirectUri,
              client_id: clientId,
              code_verifier: codeVerifier,
            }),
          });

          if (!tokenRes.ok) {
            const details = await tokenRes.text();
            throw new Error(details || "Failed to exchange authorization code");
          }

          const tokenData = (await tokenRes.json()) as {
            access_token?: unknown;
            refresh_token?: unknown;
            expires_in?: unknown;
          };
          const token = tokenData.access_token;

          // Saving `{}` here would only fail later with a misleading 401.
          if (typeof token !== "string" || token.length === 0) {
            throw new Error("Clerk returned no access token");
          }

          saveTokenResponse({ ...tokenData, access_token: token });
          resolve({ token });
          setTimeout(() => server.stop(), 500);
          return new Response("Authenticated! You can close this tab.");
        } catch (err) {
          reject(err);
          const message = errorMessage(err);
          setTimeout(() => server.stop(), 500);
          return new Response(`Authentication failed: ${message}`, {
            status: 400,
          });
        }
      },
    });

    // Build state with port and nonce
    const port = server.port;
    if (typeof port !== "number") {
      server.stop();
      reject(new Error("Failed to start callback server"));
      return;
    }

    const state = encodeState({ port, nonce });
    const redirectUri = `${apiUrl}/auth/callback`;

    const authorizeUrl = new URL(`${clerkFrontendApi}/oauth/authorize`);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    // `offline_access` is what makes Clerk hand back a refresh token, so the
    // session outlives the ~1-hour access token without another browser trip.
    authorizeUrl.searchParams.set(
      "scope",
      "openid email profile offline_access",
    );
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "login");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

    // On a headless box a swallowed rejection would leave the user waiting
    // out the full timeout for a browser that never opened.
    open(authorizeUrl.toString()).catch(() => {
      if (settled) {
        return;
      }
      settled = true;
      server.stop();
      reject(
        new Error(
          "Couldn't open a browser. Set the BROWSER env var and try again.",
        ),
      );
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        server.stop();
        reject(new Error("Login timed out"));
      }
    }, LOGIN_TIMEOUT_MS);
  });
}

export type RefreshOutcome =
  /** A fresh access token is saved and returned. */
  | { status: "refreshed"; token: string }
  /** Clerk refused (revoked/expired grant) or there is nothing to refresh with — sign out. */
  | { status: "rejected" }
  /** Clerk was unreachable; the stored auth may still be good, keep it. */
  | { status: "unavailable" };

// Concurrent 401s (a poll burst when the token expires) must share one
// exchange: Clerk rotates the refresh token on use, so a second concurrent
// exchange would present the already-spent one and get the session revoked.
let refreshInFlight: Promise<RefreshOutcome> | null = null;

/** Trade the stored refresh token for a fresh access token. Never throws. */
export function refreshAccessToken(): Promise<RefreshOutcome> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
  const clientId = process.env.CLERK_OAUTH_CLIENT_ID;
  const refreshToken = getAuth()?.refreshToken;

  // No grant (a pre-refresh-support session) or no way to use one: the old
  // 401 behavior — treat it as signed out — is the only honest answer.
  if (!clerkFrontendApi || !clientId || !refreshToken) {
    return { status: "rejected" };
  }

  let response: Response;
  try {
    response = await fetch(`${clerkFrontendApi}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
  } catch {
    return { status: "unavailable" };
  }

  // 5xx is Clerk's problem, not proof our grant is dead.
  if (response.status >= 500) {
    return { status: "unavailable" };
  }

  if (!response.ok) {
    return { status: "rejected" };
  }

  let data: {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return { status: "unavailable" };
  }

  const token = data.access_token;
  if (typeof token !== "string" || token.length === 0) {
    return { status: "rejected" };
  }

  saveTokenResponse({ ...data, access_token: token }, refreshToken);
  return { status: "refreshed", token };
}
