import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import * as HttpStatusCodes from "stoker/http-status-codes";

import type { AuthenticatedEnv } from "./require-auth";
import { rateLimit } from "./rate-limit";

/**
 * The middleware keys its buckets off `userId`, which `requireAuth` normally
 * provides. A stub that stamps the id straight onto the context keeps these
 * tests about counting, not about authentication.
 */
function appFor(options: { windowMs: number; max: number }) {
  const app = new Hono<AuthenticatedEnv>();

  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user") ?? "user_1");
    await next();
  });

  app.use("*", rateLimit(options));
  app.get("/", (c) => c.json({ ok: true }));

  return app;
}

function request(app: Hono<AuthenticatedEnv>, user = "user_1") {
  return app.request("/", { headers: { "x-test-user": user } });
}

describe("rateLimit", () => {
  test("passes requests under the limit", async () => {
    const app = appFor({ windowMs: 60_000, max: 2 });

    expect((await request(app)).status).toBe(HttpStatusCodes.OK);
    expect((await request(app)).status).toBe(HttpStatusCodes.OK);
  });

  test("answers the request over the limit with a 429 problem", async () => {
    const app = appFor({ windowMs: 60_000, max: 2 });

    await request(app);
    await request(app);
    const response = await request(app);

    expect(response.status).toBe(HttpStatusCodes.TOO_MANY_REQUESTS);
    expect(response.headers.get("content-type")).toBe(
      "application/problem+json",
    );
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);

    const problem = (await response.json()) as { status: number };
    expect(problem.status).toBe(HttpStatusCodes.TOO_MANY_REQUESTS);
  });

  test("counts each user separately", async () => {
    const app = appFor({ windowMs: 60_000, max: 1 });

    expect((await request(app, "alice")).status).toBe(HttpStatusCodes.OK);
    expect((await request(app, "alice")).status).toBe(
      HttpStatusCodes.TOO_MANY_REQUESTS,
    );

    // Alice exhausting her budget must not spend Bob's.
    expect((await request(app, "bob")).status).toBe(HttpStatusCodes.OK);
  });

  test("grants a fresh budget once the window has passed", async () => {
    const app = appFor({ windowMs: 30, max: 1 });

    expect((await request(app)).status).toBe(HttpStatusCodes.OK);
    expect((await request(app)).status).toBe(
      HttpStatusCodes.TOO_MANY_REQUESTS,
    );

    await Bun.sleep(40);

    expect((await request(app)).status).toBe(HttpStatusCodes.OK);
  });
});
