import { createMiddleware } from "hono/factory";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { problemFor, problemResponse } from "../lib/problem-details";
import type { AuthenticatedEnv } from "./require-auth";

export function rateLimit(options: { windowMs: number; max: number }) {
  type Bucket = { count: number; resetAt: number };

  const buckets = new Map<string, Bucket>();

  const SWEEP_THRESHOLD = 10_000;

  const sweep = (now: number) => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  };

  return createMiddleware<AuthenticatedEnv>(async (c, next) => {
    const key = c.get("userId");
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= SWEEP_THRESHOLD) {
        sweep(now);
      }
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    if (bucket.count > options.max) {
      c.var.logger?.warn({ userId: key }, "Rate limit exceeded");

      c.header(
        "Retry-After",
        String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
      );

      return problemResponse(
        c,
        problemFor(c, {
          status: HttpStatusCodes.TOO_MANY_REQUESTS,
          detail: "Too many requests. Wait a moment and try again.",
        }),
      );
    }

    await next();
  });
}
