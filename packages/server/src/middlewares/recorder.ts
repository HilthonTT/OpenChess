import { getConnInfo } from "@hono/node-server/conninfo";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

import env from "../env";
import type { AppBindings } from "../lib/types";

/**
 * Health checks are polled every few seconds by the platform and by uptime
 * monitors; recording them buries the traffic anyone actually looks at.
 */
const IGNORED_PATHS = new Set(["/api/health", "/api/health/deep"]);

/**
 * The app router runs with `strict: false`, so `/api/health/` reaches the same
 * handler as `/api/health` — match it the same way here, or a monitor with a
 * trailing slash walks straight past the filter.
 */
function isIgnored(path: string): boolean {
  return IGNORED_PATHS.has(
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path,
  );
}

/** `::ffff:255.255.255.255` — the longest textual address we accept. */
const MAX_IP_LENGTH = 45;

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Deliberately loose: the point is to reject anything that is not plausibly an
// address, not to re-implement RFC 4291. Anything that survives is limited to
// hex digits, colons and dots, so it cannot forge a log line or a JSON field.
const IPV6 = /^[0-9a-f]{0,4}(:[0-9a-f.]{0,4}){2,7}(%[0-9a-z]{1,16})?$/i;

/**
 * Parse one hop out of a forwarded-for chain (or a socket peer address) into a
 * bare address, or `undefined` if it is not one.
 *
 * Every value that reaches here except the socket peer is attacker-controlled:
 * `X-Forwarded-For` is a request header like any other, so a client can put a
 * megabyte of newlines in it. Returning only values that match an address shape
 * keeps forged records — and forged log *lines*, under a non-JSON transport —
 * out of the log.
 */
export function normalizeIp(raw: string): string | undefined {
  let value = raw.trim();

  if (!value || value.length > MAX_IP_LENGTH + 8) {
    return undefined;
  }

  // Some proxies append the source port: `1.2.3.4:51324`, `[2001:db8::1]:51324`.
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) {
      return undefined;
    }
    value = value.slice(1, end);
  } else if (value.split(":").length === 2) {
    value = value.slice(0, value.indexOf(":"));
  }

  // Node reports an IPv4 peer of a dual-stack socket as `::ffff:1.2.3.4`;
  // logging the two forms of one address as if they were different callers
  // makes them impossible to correlate.
  if (value.toLowerCase().startsWith("::ffff:")) {
    value = value.slice(7);
  }

  if (value.length > MAX_IP_LENGTH) {
    return undefined;
  }

  return IPV4.test(value) || IPV6.test(value) ? value : undefined;
}

/** The address of whatever socket is actually talking to us. Unspoofable. */
function getPeerIp(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    return address ? normalizeIp(address) : undefined;
  } catch {
    // The Node adapter reads the address off `c.env.server.incoming.socket`,
    // which only exists when the request came in over a real socket. Anything
    // that calls `app.fetch`/`app.request` directly — tests, the Inngest dev
    // handler — has no peer to report, and that is not an error.
    return undefined;
  }
}

/**
 * The client's address as far as we are willing to believe it.
 *
 * `X-Forwarded-For` is only consulted when `TRUST_PROXY` says a proxy we
 * control sits in front of us and rewrites it. Read unconditionally it is a
 * free-text field: a client can send `X-Forwarded-For: 8.8.8.8` and every
 * record of what it did names Google instead. The leftmost entry is the
 * original client under a well-behaved chain.
 */
function getClientIp(c: Context, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
      for (const hop of forwardedFor.split(",")) {
        // Skip the `unknown` and obfuscated identifiers RFC 7239 allows, rather
        // than giving up on a chain that starts with one.
        const ip = normalizeIp(hop);
        if (ip) {
          return ip;
        }
      }
    }

    const realIp = c.req.header("x-real-ip");
    if (realIp) {
      const ip = normalizeIp(realIp);
      if (ip) {
        return ip;
      }
    }
  }

  return getPeerIp(c);
}

/**
 * Records the caller's IP address against the request.
 *
 * The address is attached to the request-scoped pino logger rather than logged
 * on its own line: `pinoLogger` already emits one structured record per request
 * carrying the method, path, status, duration and requestId, so this puts the
 * caller on that record instead of printing a second, half-redundant one that
 * nothing can join back to it. Must therefore be registered after `pinoLogger`.
 */
export function createRecorder(options: { trustProxy: boolean }) {
  return createMiddleware<AppBindings>(async (c, next) => {
    if (isIgnored(c.req.path)) {
      return next();
    }

    // `unknown` rather than omitting the field: a record with no `ip` reads as
    // "the recorder did not run", which is a different thing to investigate
    // than "we could not tell who this was".
    c.var.logger?.assign({
      ip: getClientIp(c, options.trustProxy) ?? "unknown",
    });

    await next();
  });
}

export const recorder = createRecorder({ trustProxy: env.TRUST_PROXY });
