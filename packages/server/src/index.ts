import * as Sentry from "@sentry/bun";

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

/**
 * How long to wait for Sentry to deliver what it is holding before the process
 * goes. Short: a report is worth a moment, and never worth the platform's
 * patience running out and turning a clean exit into a kill.
 */
const SENTRY_FLUSH_MS = 2_000;

/**
 * `Bun.serve` rather than the Node adapter, because everything else here is
 * already Bun — `@sentry/bun`, `@sentry/hono/bun`, `bun test`, `bun run`. The
 * adapter put a `node:http` compatibility layer in front of the same Bun
 * server, which cost a translation on every request and left the two halves of
 * the process disagreeing about which runtime they were on: `@sentry/bun`
 * instruments `Bun.serve`, so it was reaching through the shim to patch the
 * thing the shim was wrapping.
 *
 * It throws synchronously if the port is taken, so anything logged below this
 * line has a bound socket behind it.
 */
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
    // A second signal is an operator who has waited long enough, or a platform
    // escalating. Either way, stop asking politely.
    baseLogger.warn({ reason }, "Second shutdown request, exiting now");
    process.exit(1);
  }

  stopping = true;
  baseLogger.info({ reason }, "Shutting down");

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

  try {
    // `false` leaves the requests already in flight to finish; only new
    // connections are turned away.
    await server.stop(false);
  } catch (error) {
    baseLogger.error({ err: error }, "Error while closing the server");
    exitCode = 1;
  }

  // Closed explicitly rather than left to the process exit, so Postgres frees
  // the connections now instead of waiting for them to time out server-side —
  // a rolling deploy otherwise leaves the pool holding the old instance's
  // slots while the new one is trying to claim its own.
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

/**
 * Hand Sentry its last chance to send. A no-op with no DSN configured, which is
 * the contributor's laptop and every test run.
 */
async function flushSentry(): Promise<void> {
  if (!env.SENTRY_DSN) {
    return;
  }

  try {
    await Sentry.flush(SENTRY_FLUSH_MS);
  } catch {
    // A report that could not be delivered must not be the reason a shutdown
    // hangs or a crash becomes two crashes.
  }
}

// SIGINT is the developer's ctrl+c, SIGTERM is every platform's "wrap up now".
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, (received) => {
    void shutdown(received, 0);
  });
}

/**
 * A rejected promise nobody was waiting on.
 *
 * Reported and survived rather than fatal, which is the opposite of the runtime
 * default and is deliberate: a good deal of work here is unawaited *by design*
 * — the throttled presence write, `publishGameChanged`, the recorder — because
 * it must not be able to fail a request that already succeeded. Crashing on one
 * of those would trade a dropped background write for every open game on the
 * instance, which is a far worse outcome than the bug being reported.
 *
 * Registered here because Hono's `onError` only ever sees what is thrown inside
 * a request; without this the report went to stderr and no further.
 */
process.on("unhandledRejection", (reason) => {
  baseLogger.error({ err: reason }, "Unhandled promise rejection");
  Sentry.captureException(reason, { tags: { source: "unhandledRejection" } });
});

/**
 * A throw that escaped everything.
 *
 * Fatal, unlike the above: the stack that failed was abandoned wherever it
 * stood, so what it was holding — a half-written row, a lock, an invariant
 * between two writes — is now unknown, and a server that keeps answering
 * requests in that state gives wrong answers rather than no answers. Report it,
 * then leave through the same graceful path so the streams and the pool still
 * close properly on the way out.
 */
process.on("uncaughtException", (error) => {
  baseLogger.fatal({ err: error }, "Uncaught exception, shutting down");
  Sentry.captureException(error, { tags: { source: "uncaughtException" } });

  if (stopping) {
    // Thrown during shutdown itself. The graceful path is already running and
    // has its own deadline; re-entering it would only reset the clock.
    return;
  }

  void shutdown("uncaughtException", 1);
});
