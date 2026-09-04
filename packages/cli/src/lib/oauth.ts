import open from "open";
import { reloadAuth, saveAuth } from "./auth";
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

function decodeState(state: string) {
  return JSON.parse(Buffer.from(state, "base64url").toString()) as OAuthState;
}

export async function performLogin() {
  const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
  const clientId = process.env.CLERK_OAUTH_CLIENT_ID;
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
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

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

        try {
          const payload = decodeState(state);

          if (payload.nonce !== nonce) throw new Error("State mismatch");
        } catch (err) {
          settled = true;
          reject(err);
          setTimeout(() => server.stop(), 500);
          return new Response("Invalid state", { status: 400 });
        }

        settled = true;

        try {
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
    authorizeUrl.searchParams.set(
      "scope",
      "openid email profile offline_access",
    );
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("prompt", "login");
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");

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
  | { status: "refreshed"; token: string }
  | { status: "rejected" }
  | { status: "unavailable" };

let refreshInFlight: Promise<RefreshOutcome> | null = null;

export function refreshAccessToken(): Promise<RefreshOutcome> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(): Promise<RefreshOutcome> {
  const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
  const clientId = process.env.CLERK_OAUTH_CLIENT_ID;
  const refreshToken = reloadAuth()?.refreshToken;

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
