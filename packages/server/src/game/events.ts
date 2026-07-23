import { redis } from "../lib/upstash";

/**
 * Notification that a game moved, for the SSE streams watching it.
 *
 * Two mechanisms, because neither covers the whole problem on its own:
 *
 * - An in-process listener set. Instant, free, and correct whenever both
 *   players' requests land on the same instance — which is always, on a single
 *   instance, and is the common case on several.
 * - A change counter in Redis. When the opponent's move is handled by *another*
 *   instance, no local listener ever fires, so each stream also re-checks this
 *   counter on a tick. It exists to keep that check off Postgres: an unchanged
 *   counter is one cheap read, and the game row is only loaded when the number
 *   actually moved.
 *
 * Upstash speaks REST, which has no pub/sub and no blocking reads, so a counter
 * polled by the server is the honest shape here. The win is not that polling
 * disappeared — it is that it moved off the client. One long-lived connection
 * per player replaces a request every two seconds, each of which was costing a
 * fresh token verification and a full game load.
 *
 * With no Redis configured, `gameVersion` reports null and a stream simply
 * reloads on its tick. Slightly chattier against the database, still correct.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

/**
 * Watch `gameId` for changes made by this instance. Returns the unsubscribe
 * function, which callers must run — a stream that ends without it would leak
 * its listener and, with it, the whole game entry.
 */
export function subscribeToGame(gameId: string, listener: Listener): () => void {
  const forGame = listeners.get(gameId) ?? new Set<Listener>();
  forGame.add(listener);
  listeners.set(gameId, forGame);

  return () => {
    forGame.delete(listener);
    // Drop the empty set rather than leaving a key per game ever played.
    if (forGame.size === 0) {
      listeners.delete(gameId);
    }
  };
}

/**
 * Long enough that no live game outlives its counter, short enough that the
 * keys do not accumulate forever. A lost counter is not a correctness problem —
 * a stream that reads a missing key sees a changed value and reloads once.
 */
const VERSION_TTL_SECONDS = 24 * 60 * 60;

function versionKey(gameId: string): string {
  return `game:ver:${gameId}`;
}

/**
 * Announce that `gameId` changed.
 *
 * Deliberately not awaited by its callers and deliberately never throwing: this
 * runs after a move has already been committed, and a notification that fails to
 * send must not turn a successful move into a failed request. The stream's own
 * tick is the backstop — the worst case of a dropped notification is that the
 * opponent sees the move a tick later than they might have.
 */
export function publishGameChanged(gameId: string): void {
  for (const listener of listeners.get(gameId) ?? []) {
    try {
      listener();
    } catch {
      // One misbehaving stream must not stop the others being told.
    }
  }

  if (!redis) {
    return;
  }

  // Pipelined so the bump costs one round trip rather than two.
  void redis
    .pipeline()
    .incr(versionKey(gameId))
    .expire(versionKey(gameId), VERSION_TTL_SECONDS)
    .exec()
    .catch(() => {
      // Cross-instance watchers fall back to reloading on their tick.
    });
}

/**
 * The current change counter for `gameId`, or null when there is nothing to
 * compare against — no Redis configured, or Redis unreachable right now. A null
 * tells the caller to reload unconditionally rather than to assume nothing
 * happened, so a Redis outage costs extra queries and never a missed move.
 */
export async function gameVersion(gameId: string): Promise<number | null> {
  if (!redis) {
    return null;
  }

  try {
    return (await redis.get<number>(versionKey(gameId))) ?? 0;
  } catch {
    return null;
  }
}
