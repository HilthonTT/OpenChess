import { serve } from "@hono/node-server";

import { db } from "@openchess/database/client";

import app from "./app";
import env from "./env";
import { beginShutdown } from "./lib/shutdown";
import { baseLogger } from "./middlewares/pino-logger";

/**
 * How long a shutdown waits for the open connections to drain before the
 * process exits anyway.
 *
 * Every deployment platform sends SIGTERM and then kills what is still running
 * a fixed time later; exiting first, on our own terms, is what makes the
 * difference between a closed connection and a severed one. Comfortably under
 * the ten-to-thirty seconds the usual platforms allow, and comfortably longer
 * than any request that is not a stream — those are told to wind up rather than
 * waited on, so this is a backstop and not the normal path.
 */
const SHUTDOWN_GRACE_MS = 8_000;

// The listen callback rather than a line before `serve`: the old log announced
// the server was running and *then* attempted the bind, so a port already in
// use printed "Server is running" immediately above the error saying it was
// not. `info.port` is also the port actually bound, which is the one worth
// printing when PORT is 0.
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  baseLogger.info(
    { port: info.port, env: env.NODE_ENV },
    `Server listening on http://localhost:${info.port}`,
  );
});

let stopping = false;

function shutdown(signal: NodeJS.Signals): void {
  if (stopping) {
    // A second signal is an operator who has waited long enough, or a platform
    // escalating. Either way, stop asking politely.
    baseLogger.warn({ signal }, "Second signal received, exiting now");
    process.exit(1);
  }

  stopping = true;
  baseLogger.info({ signal }, "Shutting down");

  // Before waiting on the connections, tell the ones that would never close on
  // their own to wind up — see `lib/shutdown`.
  beginShutdown();

  const forceExit = setTimeout(() => {
    baseLogger.warn(
      { graceMs: SHUTDOWN_GRACE_MS },
      "Connections still open after the grace period, exiting anyway",
    );
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);

  // The timer must not be the thing keeping the process alive once everything
  // else has closed.
  forceExit.unref();

  server.close(async (error) => {
    if (error) {
      baseLogger.error({ err: error }, "Error while closing the server");
    }

    // Closed explicitly rather than left to the process exit, so Postgres frees
    // the connections now instead of waiting for them to time out server-side —
    // a rolling deploy otherwise leaves the pool holding the old instance's
    // slots while the new one is trying to claim its own.
    try {
      await db.$disconnect();
    } catch (disconnectError) {
      baseLogger.error(
        { err: disconnectError },
        "Error disconnecting from the database",
      );
    }

    clearTimeout(forceExit);
    baseLogger.info("Shutdown complete");
    process.exit(error ? 1 : 0);
  });
}

// SIGINT is the developer's ctrl+c, SIGTERM is every platform's "wrap up now".
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, shutdown);
}
