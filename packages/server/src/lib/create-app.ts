import type { Schema } from "hono";
import { OpenAPIHono, type Hook } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";
import { compress } from "hono/compress";
import { pinoLogger } from "../middlewares/pino-logger";
import type { PlayerEnv } from "../middlewares/require-user";
import env from "../env";
import { developmentCORS } from "../security/cors";
import { CORSSecurityPatterns } from "../security/cors-patterns";
import { securityHeadersMiddleware } from "../security/headers";
import { defaultHook, notFound, onError } from "./problem-details";
import type { AppBindings, AppOpenAPI } from "./types";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook,
  });
}

/**
 * A router for routes behind `requireAuth` + `requireUser`, whose handlers can
 * read the resolved local player off `c.get("user")`.
 */
export function createPlayerRouter() {
  return new OpenAPIHono<PlayerEnv>({
    strict: false,
    // `defaultHook` is written against AppBindings, whose Variables are a subset
    // of PlayerEnv's; Hono's Env generic is invariant, so widening needs a cast.
    defaultHook: defaultHook as unknown as Hook<
      unknown,
      PlayerEnv,
      string,
      unknown
    >,
  });
}

// In production the allowlist comes from ALLOWED_ORIGINS; locally we accept
// any localhost/127.0.0.1 origin.
function createCORS() {
  return env.NODE_ENV === "production"
    ? CORSSecurityPatterns.createEnvironmentBasedCORS()
    : developmentCORS;
}

export default function createApp() {
  const app = createRouter();
  app
    .use(requestId())
    .use(pinoLogger())
    .use(securityHeadersMiddleware())
    .use(createCORS().middleware())
    .use(compress({ contentTypeFilter: /^application\/json/ }));

  app.notFound(notFound);
  app.onError(onError);
  return app;
}

export function createTestApp<S extends Schema>(router: AppOpenAPI<S>) {
  return createApp().route("/", router);
}
