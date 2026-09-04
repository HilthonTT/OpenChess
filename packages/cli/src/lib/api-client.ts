import { hc } from "hono/client";
import type { AppType } from "@openchess/server";
import { clearAuth, getAuth } from "./auth";
import { refreshAccessToken } from "./oauth";

const REFRESH_MARGIN_MS = 60_000;

export const apiClient = hc<AppType>(
  process.env.API_URL ?? "http://localhost:3000/api",
  {
    fetch: async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      let auth = getAuth();

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

      const outcome = await refreshAccessToken();

      if (outcome.status === "refreshed") {
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${outcome.token}`);
        return fetch(input, { ...init, headers: retryHeaders });
      }

      if (outcome.status === "rejected") {
        clearAuth();
      }

      return response;
    },
  },
);
