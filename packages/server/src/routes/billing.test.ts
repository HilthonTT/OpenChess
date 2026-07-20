import { describe, expect, test } from "bun:test";
import * as HttpStatusCodes from "stoker/http-status-codes";

import app from "../app";

// A token-less request is rejected by `requireAuth` before any Clerk or Polar
// call, so these run without network. (Historically untestable: an earlier
// `mock.module("lib/auth")` in require-auth.test.ts leaked process-wide; the
// middleware now takes its verifier by injection instead.)
describe("billing auth guards", () => {
  test.each(["/api/billing/checkout", "/api/billing/portal"])(
    "POST %s challenges an anonymous caller",
    async (path) => {
      const response = await app.request(path, { method: "POST" });

      expect(response.status).toBe(HttpStatusCodes.UNAUTHORIZED);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    },
  );

  test("GET /api/billing/status challenges an anonymous caller", async () => {
    const response = await app.request("/api/billing/status");

    expect(response.status).toBe(HttpStatusCodes.UNAUTHORIZED);
  });
});

describe("GET /billing/success", () => {
  // Polar redirects the customer's browser here after checkout, and that
  // browser has no bearer token. When this route sat behind `requireAuth` it
  // 401'd every completed purchase.
  test("is reachable without a token", async () => {
    const response = await app.request("/api/billing/success");

    expect(response.status).toBe(HttpStatusCodes.OK);
  });

  test("renders a page for the human reading it, not JSON", async () => {
    const response = await app.request("/api/billing/success");

    expect(response.headers.get("content-type")).toStartWith("text/html");
    await expect(response.text()).resolves.toContain("Payment complete");
  });
});
