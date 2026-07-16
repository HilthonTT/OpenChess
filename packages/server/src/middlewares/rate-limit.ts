import { createMiddleware } from "hono/factory";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { problemFor, problemResponse } from "../lib/problem-details";
import type { AuthenticatedEnv } from "./require-auth";

/**
 * A fixed-window rate limit keyed by the authenticated user.
 *
 * In-memory on purpose: the server is a single process, and the endpoints this
 * guards (starting games, playing moves) run the chess engine per request — the
 * limit exists to stop one account from turning that into a CPU exhaustion
 * vector, not to meter an API product. If the server is ever scaled out, the
 * counters need to move to shared storage or the limit becomes per-instance.
 */
export function rateLimit(options: { windowMs: number; max: number }) {
  type Bucket = { count: number; resetAt: number };

  const buckets = new Map<string, Bucket>();

  // Expired buckets are normally replaced on the key's next request; keys that
  // never come back would leak, so a full sweep runs when the map gets large.
  const SWEEP_THRESHOLD = 10_000;

  const sweep = (now: number) => {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  };

  return createMiddleware<AuthenticatedEnv>(async (c, next) => {
    // Must run behind `requireAuth`: an anonymous request has no key here and
    // was already turned away with a 401.
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
