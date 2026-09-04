import { getConnInfo } from "hono/bun";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

import env from "../env";
import type { AppBindings } from "../lib/types";

const IGNORED_PATHS = new Set(["/api/health", "/api/health/deep"]);

function isIgnored(path: string): boolean {
  return IGNORED_PATHS.has(
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path,
  );
}

const MAX_IP_LENGTH = 45;

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

const IPV6 = /^[0-9a-f]{0,4}(:[0-9a-f.]{0,4}){2,7}(%[0-9a-z]{1,16})?$/i;

export function normalizeIp(raw: string): string | undefined {
  let value = raw.trim();

  if (!value || value.length > MAX_IP_LENGTH + 8) {
    return undefined;
  }

  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) {
      return undefined;
    }
    value = value.slice(1, end);
  } else if (value.split(":").length === 2) {
    value = value.slice(0, value.indexOf(":"));
  }

  if (value.toLowerCase().startsWith("::ffff:")) {
    value = value.slice(7);
  }

  if (value.length > MAX_IP_LENGTH) {
    return undefined;
  }

  return IPV4.test(value) || IPV6.test(value) ? value : undefined;
}

function getPeerIp(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address;
    return address ? normalizeIp(address) : undefined;
  } catch {
    return undefined;
  }
}

function getClientIp(c: Context, trustProxy: boolean): string | undefined {
  if (trustProxy) {
    const forwardedFor = c.req.header("x-forwarded-for");
    if (forwardedFor) {
      for (const hop of forwardedFor.split(",")) {
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

export function createRecorder(options: { trustProxy: boolean }) {
  return createMiddleware<AppBindings>(async (c, next) => {
    if (isIgnored(c.req.path)) {
      return next();
    }

    c.var.logger?.assign({
      ip: getClientIp(c, options.trustProxy) ?? "unknown",
    });

    await next();
  });
}

export const recorder = createRecorder({ trustProxy: env.TRUST_PROXY });
