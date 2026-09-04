import type { Schema } from "hono";
import { OpenAPIHono, type Hook } from "@hono/zod-openapi";
import { requestId } from "hono/request-id";
import { compress } from "hono/compress";
import { prettyJSON } from "hono/pretty-json";
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
import { recorder } from "../middlewares/recorder";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook,
  });
}

export function createPlayerRouter() {
  return new OpenAPIHono<PlayerEnv>({
    strict: false,
    defaultHook: defaultHook as unknown as Hook<
      unknown,
      PlayerEnv,
      string,
      unknown
    >,
  });
}

const STREAMING_PATHS = /\/events$/;

export function isStreamingPath(pathname: string): boolean {
  return STREAMING_PATHS.test(pathname);
}

const requestTimeout = createMiddleware(async (c, next) => {
  if (isStreamingPath(new URL(c.req.url).pathname)) {
    return next();
  }

  return timeout(5_000)(c, next);
});

function createCORS() {
  return env.NODE_ENV === "production"
    ? createEnvironmentBasedCORS()
    : developmentCORS;
}

export default function createApp() {
  const app = createRouter();

  if (env.SENTRY_DSN) {
    app.use(
      sentry(app, {
        dsn: env.SENTRY_DSN,
        environment: env.NODE_ENV,
        tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
        enableLogs: true,
        shouldHandleError: () => false,
      }),
    );
  }

  app
    .use(prettyJSON())
    .use(requestId())
    .use(pinoLogger())
    .use(recorder)
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
