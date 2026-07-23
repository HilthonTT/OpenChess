import type { Schema } from "hono";
import { OpenAPIHono, type Hook } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";
import { compress } from "hono/compress";
import { createMiddleware } from "hono/factory";
import { timeout } from "hono/timeout";
import { sentry } from "@sentry/hono/bun";
import { pinoLogger } from "../middlewares/pino-logger";
import type { PlayerEnv } from "../middlewares/require-user";
import env from "../env";
import { developmentCORS } from "../security/cors";
import { createEnvironmentBasedCORS } from "../security/cors-patterns";
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

/**
 * Five seconds is right for a request that computes an answer and returns it,
 * and fatal for one whose whole job is to stay open — an SSE stream lives for
 * as long as the game does. Server-Sent Events paths are exempted rather than
 * the ceiling being raised for everyone: a slow ordinary request is still a bug
 * worth cutting off at five seconds.
 */
const STREAMING_PATHS = /\/events$/;

/** Whether `pathname` is a stream, and so exempt from the request timeout. */
export function isStreamingPath(pathname: string): boolean {
  return STREAMING_PATHS.test(pathname);
}

const requestTimeout = createMiddleware(async (c, next) => {
  if (isStreamingPath(new URL(c.req.url).pathname)) {
    return next();
  }

  return timeout(5_000)(c, next);
});

// In production the allowlist comes from ALLOWED_ORIGINS; locally we accept
// any localhost/127.0.0.1 origin.
function createCORS() {
  return env.NODE_ENV === "production"
    ? createEnvironmentBasedCORS()
    : developmentCORS;
}

export default function createApp() {
  const app = createRouter();

  // First in the chain, so the request span covers every middleware below it.
  //
  // Guarded on the DSN rather than always registered: `sentry()` calls
  // `Sentry.init` as a side effect, and the test suite builds an app per file —
  // an unguarded middleware would ship the errors those tests throw on purpose
  // to the real project.
  if (env.SENTRY_DSN) {
    app.use(
      sentry(app, {
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
        enableLogs: true,
        // The middleware would otherwise capture `c.error` on its way out. Our
        // `onError` reports the same exception with the requestId attached, so
        // leave the reporting to it instead of filing every failure twice.
        shouldHandleError: () => false,
      }),
    );
  }

  app
    .use(requestId())
    .use(pinoLogger())
    .use(securityHeadersMiddleware())
    .use(createCORS().middleware())
    .use(compress({ contentTypeFilter: /^application\/json/ }))
    .use(requestTimeout);

  app.notFound(notFound);
  app.onError(onError);
  return app;
}

export function createTestApp<S extends Schema>(router: AppOpenAPI<S>) {
  return createApp().route("/", router);
}
