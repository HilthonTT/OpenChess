import moment from "moment";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";

const IGNORED_PATHS = ["/api/health", "/api/health/deep"];

function getClientIp(c: Context): string {
  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  const realIp = c.req.header("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  try {
    const raw = c.req.raw;
    if (raw && "remoteAddress" in raw) {
      const remoteAddress = (raw as any).remoteAddress;
      if (remoteAddress) {
        return remoteAddress;
      }
    }
  } catch {
    // ignore error
  }

  // fallback
  return "unknown";
}

export const recorder = createMiddleware(async (c, next) => {
  // SKip logging for specific endpoints
  const path = new URL(c.req.url).pathname;

  if (IGNORED_PATHS.includes(path)) {
    await next();
    return;
  }

  const ipAddress = getClientIp(c);

  const logMessage = `[${moment().format(
    "YYYY/MM/DD HH:mm:ss",
  )}] IP: ${ipAddress} | Method: ${c.req.method} | Path: ${path}`;

  console.log(logMessage);

  await next();
});
