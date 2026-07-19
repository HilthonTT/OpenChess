/**
 * The matchmaking queue, kept in memory.
 *
 * Nothing here is durable, and that is deliberate: a queue entry only means
 * "this player is polling right now". The client re-joins on every poll, so a
 * server restart empties the queue and the next round of polls refills it —
 * no row ever needs cleaning up. The game row is only created at the moment
 * two live players are paired, which is also why there is no such thing as a
 * stale open seat.
 *
 * Single-process by construction, like the rate limiter next door.
 */

type Entry = {
  userId: string;
  enqueuedAt: number;
  lastSeenAt: number;
};

/**
 * A player whose last poll is older than this is gone, not waiting. The client
 * polls every couple of seconds; five missed polls is a closed terminal, not a
 * slow network.
 */
export const QUEUE_STALE_MS = 10_000;

/** Insertion order is the FIFO: Maps iterate in the order keys were added. */
const queue = new Map<string, Entry>();

/**
 * Players whose game row is being created right now. Pairing removes both
 * sides from the queue synchronously, but the row lands after an await — and
 * without this marker, the partner's next poll would see an empty queue, no
 * game, and re-enqueue them into a second pairing.
 */
const pairing = new Set<string>();

/** Join the queue, or refresh the heartbeat of an entry already in it. */
export function heartbeat(userId: string, now: number = Date.now()): void {
  const entry = queue.get(userId);

  if (entry) {
    entry.lastSeenAt = now;
    return;
  }

  queue.set(userId, { userId, enqueuedAt: now, lastSeenAt: now });
}

/**
 * Take the longest-waiting live player other than `userId` out of the queue,
 * marking both sides as mid-pairing. Returns null when nobody suitable is
 * waiting — stale entries are dropped rather than matched, so a player who
 * closed their terminal minutes ago never gets a game they will not show up to.
 *
 * The caller owns the follow-through: create the game row, then call
 * `completePairing` (in a finally) so a failed create returns both players to
 * circulation instead of stranding them.
 */
export function takePartner(
  userId: string,
  now: number = Date.now(),
): string | null {
  for (const entry of queue.values()) {
    if (now - entry.lastSeenAt > QUEUE_STALE_MS) {
      queue.delete(entry.userId);
      continue;
    }

    if (entry.userId === userId || pairing.has(entry.userId)) {
      continue;
    }

    queue.delete(entry.userId);
    queue.delete(userId);
    pairing.add(entry.userId);
    pairing.add(userId);
    return entry.userId;
  }

  return null;
}

/** Whether a game row is being created for this player right now. */
export function isPairing(userId: string): boolean {
  return pairing.has(userId);
}

/** Release players from the mid-pairing marker, whatever the create's fate. */
export function completePairing(...userIds: string[]): void {
  for (const userId of userIds) {
    pairing.delete(userId);
  }
}

/** Leave the queue. A no-op for players not in it, so a retry costs nothing. */
export function leave(userId: string): void {
  queue.delete(userId);
}

/** Empty everything. For tests only. */
export function reset(): void {
  queue.clear();
  pairing.clear();
}
