import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { AppBindings } from "../lib/types";
import { createRecorder, normalizeIp } from "./recorder";

/**
 * The middleware records the caller by assigning to the request-scoped pino
 * logger, so the assertion target is the bindings it assigned. A stub standing
 * in for `pinoLogger` keeps these tests about which address is believed, and
 * off the shape of a real log line.
 */
function appFor(options: { trustProxy: boolean }) {
  const assigned: Record<string, unknown>[] = [];

  const app = new Hono<AppBindings>();

  app.use("*", async (c, next) => {
    c.set("logger", {
      assign: (bindings: Record<string, unknown>) => {
        assigned.push(bindings);
      },
    } as never);
    await next();
  });

  app.use("*", createRecorder(options));
  app.get("*", (c) => c.json({ ok: true }));

  return { app, assigned };
}

async function recordedIp(
  options: { trustProxy: boolean },
  headers: Record<string, string> = {},
  path = "/api/games",
) {
  const { app, assigned } = appFor(options);
  await app.request(path, { headers });
  return assigned[0]?.ip;
}

describe("recorder", () => {
  test("records the forwarded client when a proxy is trusted", async () => {
    const ip = await recordedIp(
      { trustProxy: true },
      { "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" },
    );

    // The leftmost hop is the original client; the rest are proxies.
    expect(ip).toBe("203.0.113.7");
  });

  test("falls back to x-real-ip when there is no forwarded chain", async () => {
    const ip = await recordedIp(
      { trustProxy: true },
      { "x-real-ip": " 203.0.113.9 " },
    );

    expect(ip).toBe("203.0.113.9");
  });

  test("ignores forwarded headers when no proxy is trusted", async () => {
    // The whole point of TRUST_PROXY=false: a client that names itself must not
    // be believed, so with no socket peer to fall back on this is unknown.
    const ip = await recordedIp(
      { trustProxy: false },
      { "x-forwarded-for": "8.8.8.8" },
    );

    expect(ip).toBe("unknown");
  });

  test("skips hops that are not addresses", async () => {
    const ip = await recordedIp(
      { trustProxy: true },
      { "x-forwarded-for": "unknown, _hidden, 203.0.113.7" },
    );

    expect(ip).toBe("203.0.113.7");
  });

  test("refuses a forged hop rather than logging it", async () => {
    const ip = await recordedIp(
      { trustProxy: true },
      {
        "x-forwarded-for":
          '203.0.113.7 level=error msg="database dropped"'.replace(
            "203.0.113.7",
            "not-an-ip",
          ),
      },
    );

    expect(ip).toBe("unknown");
  });

  test("records nothing for the health checks", async () => {
    const { app, assigned } = appFor({ trustProxy: true });

    await app.request("/api/health", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    });
    await app.request("/api/health/deep");
    // `strict: false` routes the trailing-slash form to the same handler.
    await app.request("/api/health/");

    expect(assigned).toHaveLength(0);
  });
});

describe("normalizeIp", () => {
  test("accepts plain addresses", () => {
    expect(normalizeIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
    expect(normalizeIp("  203.0.113.7  ")).toBe("203.0.113.7");
  });

  test("unwraps an IPv4-mapped IPv6 address", () => {
    // Node hands these back for IPv4 peers of a dual-stack socket; the two
    // spellings of one address have to collapse to one, or they cannot be
    // correlated in the logs.
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeIp("::FFFF:203.0.113.7")).toBe("203.0.113.7");
  });

  test("strips a source port", () => {
    expect(normalizeIp("203.0.113.7:51324")).toBe("203.0.113.7");
    expect(normalizeIp("[2001:db8::1]:51324")).toBe("2001:db8::1");
  });

  test("rejects anything that is not an address", () => {
    expect(normalizeIp("")).toBeUndefined();
    expect(normalizeIp("unknown")).toBeUndefined();
    expect(normalizeIp("203.0.113.999")).toBeUndefined();
    expect(normalizeIp("[2001:db8::1")).toBeUndefined();
    expect(normalizeIp("example.com")).toBeUndefined();
    // A log-injection attempt, and an unbounded header.
    expect(normalizeIp('203.0.113.7"\n{"level":30}')).toBeUndefined();
    expect(normalizeIp("1".repeat(1024))).toBeUndefined();
  });
});
