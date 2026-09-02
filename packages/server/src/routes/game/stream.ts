import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { gameVersion, subscribeToGame } from "../../game/events";
import { isShuttingDown, onShutdown } from "../../lib/shutdown";
import type { PlayerEnv } from "../../middlewares/require-user";

/**
 * How often a stream re-checks a game it has heard nothing about.
 *
 * A move made on *this* instance wakes the stream immediately, so this tick is
 * only the cross-instance path. Two seconds matches what the client used to poll
 * at, so a multi-instance deployment is never slower than it was — and on the
 * common path it is now as fast as the network allows.
 */
const REVALIDATE_MS = 2_000;

/**
 * A comment sent when nothing has happened, purely so idle connections stay
 * open. Proxies and load balancers cut streams that go quiet, and a chess game
 * can legitimately have nothing to say for minutes at a time.
 */
const KEEPALIVE_MS = 15_000;

/**
 * How long the stream stays open after the game settles.
 *
 * A settled game has no more moves, which is why this used to hang up on the
 * result — but it is not out of things to say. "Good game" is said *after* the
 * final position, and a stream that closed on the result would deliver every
 * message except the one people actually send. So the loop keeps running for a
 * minute and a half past the end, long enough for the customary exchange and
 * short enough that a finished game is not holding connections open.
 *
 * Only for a game that settles *while* being watched. One that was already over
 * when the stream opened sends its state and hangs up, because nobody is
 * standing at that board.
 */
const POST_SETTLE_LINGER_MS = 90_000;

/**
 * Wait for the game to change, or for the tick to elapse, whichever comes
 * first — and report which it was, because only a tick needs the version check
 * that follows it.
 */
function waitForChange(
  gameId: string,
  signal: AbortSignal,
): Promise<"changed" | "tick"> {
  return new Promise((resolve) => {
    let settled = false;
    /**
     * Assigned below rather than declared there: `onShutdown` runs its listener
     * on the spot if shutdown has already begun, and that listener calls
     * `finish`, which would reach a `const` still in its dead zone. A no-op
     * placeholder makes the ordering safe instead of merely unlikely.
     */
    let unsubscribeShutdown: () => void = () => {};

    const finish = (reason: "changed" | "tick") => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      unsubscribeShutdown();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(reason);
    };

    // An aborted request resolves as a tick; the loop then sees the abort on
    // its own condition and exits without touching the database.
    const onAbort = () => finish("tick");
    const unsubscribe = subscribeToGame(gameId, () => finish("changed"));
    const timer = setTimeout(() => finish("tick"), REVALIDATE_MS);

    signal.addEventListener("abort", onAbort, { once: true });

    // Last, so everything `finish` touches is initialised before a shutdown
    // already under way can fire this listener synchronously. A shutdown
    // resolves as a tick for the same reason an abort does: the loop owns the
    // decision to stop and checks `isShuttingDown` on its own condition, so
    // waking it is all this has to do.
    unsubscribeShutdown = onShutdown(() => finish("tick"));
  });
}

/**
 * The live feed for one game, in whatever shape the caller is entitled to.
 *
 * Registered with `.get` rather than `.openapi` because the response is a
 * `text/event-stream` rather than a modelled JSON body — it is documented in the
 * README instead, and the CLI reads it with a plain fetch. Both streams still
 * sit behind the `requireAuth`/`requireUser` middleware above, and the loader
 * each one is given is the same authorization check the polling route makes, so
 * neither exposes anything the polling routes did not.
 *
 * Events are `state`, carrying exactly the JSON body of the matching GET. The
 * first one is sent immediately so a client needs no separate fetch to start,
 * and the stream closes itself shortly after the game is over: the position has
 * nothing further to say, but the players do — see `POST_SETTLE_LINGER_MS`.
 */
export function streamGameState<T extends { result: string | null }>(
  c: Context<PlayerEnv>,
  gameId: string,
  load: () => Promise<T>,
  /**
   * Everything about the state a client would want to be told about, as one
   * comparable value.
   *
   * Passed in rather than computed here because the two feeds are entitled to
   * different facts, and getting this wrong is silent: a change left out of the
   * signature is not delivered late, it is never delivered at all. The ply and
   * the result are the obvious pair and would have been the whole of it — but a
   * draw offer moves neither, nor does a takeback request, nor does a message,
   * so a signature of `ply|result` filters out every one of the changes that
   * are pure conversation.
   */
  signature: (state: T) => string,
) {
  return streamSSE(c, async (stream) => {
    let lastSignature: string | null = null;
    let knownVersion = await gameVersion(gameId);
    let quietSince = Date.now();
    /** When to hang up on a settled game; null while it is still live. */
    let hangUpAt: number | null = null;

    const keepaliveIfQuiet = async () => {
      if (Date.now() - quietSince >= KEEPALIVE_MS) {
        await stream.write(": keepalive\n\n");
        quietSince = Date.now();
      }
    };

    while (!stream.aborted && !stream.closed && !isShuttingDown()) {
      const state = await load();
      const current = signature(state);

      // Resend only on a real change. A client holding a picked-up piece must
      // not have its selection cleared by an event that says nothing new.
      if (current !== lastSignature) {
        const first = lastSignature === null;
        lastSignature = current;
        quietSince = Date.now();

        await stream.writeSSE({
          event: "state",
          data: JSON.stringify(state),
        });

        // A game that was already over when the stream opened has nobody
        // standing at it; one that settles while being watched gets the linger.
        if (first && state.result !== null) {
          break;
        }
      } else {
        // Reached on every tick when Redis is absent (nothing to compare, so
        // each one reloads), and idle proxies still need bytes to flow.
        await keepaliveIfQuiet();
      }

      if (state.result !== null) {
        hangUpAt ??= Date.now() + POST_SETTLE_LINGER_MS;

        if (Date.now() >= hangUpAt) {
          break;
        }
      }

      // Sit out quiet ticks here, without touching the database: only a moved
      // counter — or one we cannot read, where stale is the greater risk — is
      // worth paying for a reload.
      //
      // The linger deadline is re-checked on each tick as well as above: a
      // settled game nobody says anything in produces no changes at all, and a
      // wait that only ended on one would hold the connection open forever.
      while (
        !stream.aborted &&
        !stream.closed &&
        !isShuttingDown() &&
        (hangUpAt === null || Date.now() < hangUpAt)
      ) {
        const reason = await waitForChange(gameId, c.req.raw.signal);

        if (stream.aborted || stream.closed) {
          break;
        }

        if (reason === "changed") {
          knownVersion = await gameVersion(gameId);
          break;
        }

        const version = await gameVersion(gameId);

        if (version === null || version !== knownVersion) {
          knownVersion = version;
          break;
        }

        await keepaliveIfQuiet();
      }
    }
  });
}
