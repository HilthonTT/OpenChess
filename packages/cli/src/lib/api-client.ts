import { hc } from "hono/client";
import type { AppType } from "@openchess/server";
import { clearAuth, getAuth } from "./auth";
import { refreshAccessToken } from "./oauth";

/** Renew this far before expiry, so a request never rides a dying token. */
const REFRESH_MARGIN_MS = 60_000;

export const apiClient = hc<AppType>(
  process.env.API_URL ?? "http://localhost:3000/api",
  {
    fetch: async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      let auth = getAuth();

      // Proactive renewal: expired-token 401s are routine (~1-hour life), and
      // renewing ahead of the deadline spares every poll the failed round
      // trip. Best-effort — a miss just falls through to the 401 path below.
      if (
        auth?.refreshToken &&
        auth.expiresAt !== undefined &&
        Date.now() > auth.expiresAt - REFRESH_MARGIN_MS
      ) {
        await refreshAccessToken();
        auth = getAuth();
      }

      const headers = new Headers(init?.headers);

      if (auth) {
        headers.set("Authorization", `Bearer ${auth.token}`);
      }

      const response = await fetch(input, { ...init, headers });

      if (response.status !== 401 || !auth) {
        return response;
      }

      // The server rejected the token anyway. One refresh-and-replay before
      // giving up; the request bodies hono's client sends are strings, so a
      // replay is safe.
      const outcome = await refreshAccessToken();

      if (outcome.status === "refreshed") {
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${outcome.token}`);
        return fetch(input, { ...init, headers: retryHeaders });
      }

      if (outcome.status === "rejected") {
        // The session is truly over; listeners flip the UI to signed-out.
        clearAuth();
      }

      // "unavailable" keeps the stored auth: Clerk being down is not proof
      // the session ended, and the next request will try again.
      return response;
    },
  },
);
