import { describe, expect, test } from "bun:test";
import * as HttpStatusCodes from "stoker/http-status-codes";

import app from "../app";

// There is no coverage here for `/checkout` and `/portal` rejecting an
// anonymous caller, which is what `requireAuth` on those two paths is for.
// `require-auth.test.ts` replaces `lib/auth` with `mock.module`, which is
// process-wide and outlives that file, so by the time these tests run an
// unauthenticated request is answered by whatever actor that mock was last left
// holding. The guard itself is covered by `require-auth.test.ts`.
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
