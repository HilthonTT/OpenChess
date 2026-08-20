/**
 * The process-wide "we are going away" signal.
 *
 * `server.close()` stops accepting new connections and then waits for the open
 * ones to finish — which is exactly right for a request that computes an answer
 * and returns it, and useless for a stream whose whole job is to stay open. A
 * game's SSE feed lives for as long as the game does, so a shutdown that only
 * waited would sit out its entire grace period and then sever the streams
 * anyway, which is the abrupt ending it was meant to avoid.
 *
 * So the long-lived work is told, rather than waited on: it winds itself up,
 * its connections close, and `server.close()` finds nothing left to wait for.
 *
 * A listener set rather than an `AbortSignal` because there is one subscriber
 * per open stream and no bound on how many that is — a shared signal would need
 * its listener cap lifted and would leak a listener per stream that forgot to
 * remove its own.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

let shuttingDown = false;

/** Whether shutdown has begun. Loops that can run for a while should check it. */
export function isShuttingDown(): boolean {
  return shuttingDown;
}

/**
 * Run `listener` when shutdown begins, and return the unsubscribe function —
 * which callers must run, or a set that outlives every stream ever opened grows
 * one entry at a time.
 *
 * Subscribing after shutdown has already begun runs `listener` immediately: the
 * announcement is not repeated, and a caller that missed it would otherwise wait
 * for a second one that never comes.
 */
export function onShutdown(listener: Listener): () => void {
  if (shuttingDown) {
    listener();
    return () => {};
  }

  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announce that the process is shutting down. Idempotent — two signals in quick
 * succession are one shutdown, and the second must not tell everyone twice.
 */
export function beginShutdown(): void {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One stream failing to wind up must not strand the rest still open.
    }
  }

  listeners.clear();
}

/** Test-only: forget that shutdown happened, so each case starts from rest. */
export function resetShutdownForTests(): void {
  shuttingDown = false;
  listeners.clear();
}
