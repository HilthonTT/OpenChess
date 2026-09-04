import * as Sentry from "@sentry/bun";

import { db } from "@openchess/database/client";

import app from "./app";
import env from "./env";
import { beginShutdown } from "./lib/shutdown";
import { baseLogger } from "./middlewares/pino-logger";

const SHUTDOWN_GRACE_MS = 8_000;

const SENTRY_FLUSH_MS = 2_000;

const server = Bun.serve({
  fetch: app.fetch,
  port: env.PORT,
});

baseLogger.info(
  { port: server.port, env: env.NODE_ENV },
  `Server listening on ${server.url}`,
);

let stopping = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (stopping) {
    baseLogger.warn({ reason }, "Second shutdown request, exiting now");
    process.exit(1);
  }

  stopping = true;
  baseLogger.info({ reason }, "Shutting down");

  beginShutdown();

  const forceExit = setTimeout(() => {
    baseLogger.warn(
      { graceMs: SHUTDOWN_GRACE_MS },
      "Connections still open after the grace period, exiting anyway",
    );
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);

  forceExit.unref();

  try {
    await server.stop(false);
  } catch (error) {
    baseLogger.error({ err: error }, "Error while closing the server");
    exitCode = 1;
  }

  try {
    await db.$disconnect();
  } catch (error) {
    baseLogger.error({ err: error }, "Error disconnecting from the database");
  }

  await flushSentry();

  clearTimeout(forceExit);
  baseLogger.info("Shutdown complete");
  process.exit(exitCode);
}

async function flushSentry(): Promise<void> {
  if (!env.SENTRY_DSN) {
    return;
  }

  try {
    await Sentry.flush(SENTRY_FLUSH_MS);
  } catch {}
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, (received) => {
    void shutdown(received, 0);
  });
}

process.on("unhandledRejection", (reason) => {
  baseLogger.error({ err: reason }, "Unhandled promise rejection");
  Sentry.captureException(reason, { tags: { source: "unhandledRejection" } });
});

process.on("uncaughtException", (error) => {
  baseLogger.fatal({ err: error }, "Uncaught exception, shutting down");
  Sentry.captureException(error, { tags: { source: "uncaughtException" } });

  if (stopping) {
    return;
  }

  void shutdown("uncaughtException", 1);
});
