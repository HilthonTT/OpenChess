import { redis } from "../lib/upstash";

/**
 * The matchmaking queue.
 *
 * Backed by Redis when Upstash is configured, and by an in-process copy when it
 * is not. The semantics are identical either way, which is what lets `bun test`
 * and a solo `bun run dev:server` need no Redis at all while a deployment of
 * more than one instance still gets a queue every instance can see. Before this,
 * two instances meant two disjoint queues and a player could wait forever beside
 * an opponent the other instance was holding.
 *
 * Nothing here is durable in either backend, and that is still deliberate: a
 * queue entry only means "this player is polling right now". The client
 * re-joins on every poll, so losing the queue — a restart, a Redis eviction —
 * empties it and the next round of polls refills it. No row ever needs cleaning
 * up, and there is no such thing as a stale open seat, because the game row is
 * only created at the moment two live players are paired.
 *
 * Redis keys all carry the `{mm}` hash tag so a clustered deployment keeps them
 * in one slot — the pairing script touches several at once, and Redis will only
 * run a multi-key script when every key it names lives on the same node.
 */

/**
 * A player's chosen clock while they wait, or null for an untimed match. Two
 * players are only paired when theirs are equal — a bullet seeker never lands
 * in a rapid game — so the single FIFO doubles as one queue per time control.
 */
export type QueueTimeControl = string | null;

/**
 * A player whose last poll is older than this is gone, not waiting. The client
 * polls every couple of seconds; five missed polls is a closed terminal, not a
 * slow network.
 */
export const QUEUE_STALE_MS = 10_000;

/**
 * How long a mid-pairing marker survives on its own.
 *
 * The in-memory backend clears markers in a `finally`, which cannot run if the
 * process dies between taking a partner and writing the game row — the two
 * players would then be stranded, unpairable, until a restart. In Redis the
 * marker simply expires, so the worst case is a few seconds of waiting rather
 * than a permanent hole. Comfortably longer than a game insert, comfortably
 * shorter than a player's patience.
 */
const PAIRING_TTL_MS = 15_000;

/** Untimed is a real queue, not an absent one; give it a name Redis can store. */
const UNTIMED = "untimed";

function label(timeControl: QueueTimeControl): string {
  return timeControl ?? UNTIMED;
}

const QUEUE_KEY = "mm:{mm}:queue";
const SEEN_KEY = "mm:{mm}:seen";
const CLOCK_KEY = "mm:{mm}:clock";
const PAIRING_PREFIX = "mm:{mm}:pairing:";

const KEYS = [QUEUE_KEY, SEEN_KEY, CLOCK_KEY];

/**
 * Join the queue, or refresh the heartbeat of an entry already in it.
 *
 * A player already waiting on this clock keeps their place — the heartbeat only
 * touches liveness, never seniority — while one who re-polls with a different
 * clock is moved to the back of the new line, which is what a player changing
 * their mind expects rather than inheriting a wait they abandoned.
 */
const HEARTBEAT_SCRIPT = `
local queue, seen, clock = KEYS[1], KEYS[2], KEYS[3]
local user, want, now = ARGV[1], ARGV[2], tonumber(ARGV[3])

local current = redis.call('HGET', clock, user)
local queued = redis.call('ZSCORE', queue, user)

if queued and current == want then
  redis.call('ZADD', seen, now, user)
else
  redis.call('ZADD', queue, now, user)
  redis.call('ZADD', seen, now, user)
  redis.call('HSET', clock, user, want)
end

return 1
`;

/**
 * Take the longest-waiting live player other than the caller, marking both
 * sides as mid-pairing. Returns an empty string when nobody suitable is waiting.
 *
 * Written as one script because every step of it has to be atomic against
 * another instance running the same script: two overlapping polls must not both
 * walk away with the same partner, and a partner must not be handed out in the
 * window between reading the queue and removing them from it.
 */
const TAKE_PARTNER_SCRIPT = `
local queue, seen, clock = KEYS[1], KEYS[2], KEYS[3]
local user, want = ARGV[1], ARGV[2]
local now, stale, ttl = tonumber(ARGV[3]), tonumber(ARGV[4]), tonumber(ARGV[5])
local prefix = ARGV[6]

-- A caller already mid-pairing must not open a second one.
if redis.call('EXISTS', prefix .. user) == 1 then
  return ''
end

local members = redis.call('ZRANGE', queue, 0, -1)

for i = 1, #members do
  local other = members[i]
  local last = tonumber(redis.call('ZSCORE', seen, other) or '0')

  if now - last > stale then
    -- Gone, not waiting. Dropped rather than matched, so a player who closed
    -- their terminal minutes ago never gets a game they will not show up to.
    redis.call('ZREM', queue, other)
    redis.call('ZREM', seen, other)
    redis.call('HDEL', clock, other)
  elseif other ~= user
    and redis.call('HGET', clock, other) == want
    and redis.call('EXISTS', prefix .. other) == 0 then

    redis.call('ZREM', queue, other, user)
    redis.call('ZREM', seen, other, user)
    redis.call('HDEL', clock, other, user)
    redis.call('SET', prefix .. other, '1', 'PX', ttl)
    redis.call('SET', prefix .. user, '1', 'PX', ttl)

    return other
  end
end

return ''
`;

/* ------------------------------------------------------------------------- *
 * The in-process backend: the original queue, unchanged in behaviour.
 * ------------------------------------------------------------------------- */

type Entry = {
  userId: string;
  timeControl: string;
  enqueuedAt: number;
  lastSeenAt: number;
};

/** Insertion order is the FIFO: Maps iterate in the order keys were added. */
const queue = new Map<string, Entry>();

/**
 * Players whose game row is being created right now. Pairing removes both sides
 * from the queue synchronously, but the row lands after an await — and without
 * this marker, the partner's next poll would see an empty queue, no game, and
 * re-enqueue them into a second pairing.
 */
const pairing = new Set<string>();

function localHeartbeat(userId: string, want: string, now: number): void {
  const entry = queue.get(userId);

  if (entry && entry.timeControl === want) {
    entry.lastSeenAt = now;
    return;
  }

  // Re-insert (deleting first) so a switched time control also moves the player
  // to the back of the FIFO, rather than keeping a seniority they abandoned.
  queue.delete(userId);
  queue.set(userId, {
    userId,
    timeControl: want,
    enqueuedAt: now,
    lastSeenAt: now,
  });
}

function localTakePartner(
  userId: string,
  want: string,
  now: number,
): string | null {
  // The service checks `isPairing` too, but that check goes stale across an
  // await; this one is atomic with the take, so two overlapping polls from the
  // same player cannot both pair.
  if (pairing.has(userId)) {
    return null;
  }

  for (const entry of queue.values()) {
    if (now - entry.lastSeenAt > QUEUE_STALE_MS) {
      queue.delete(entry.userId);
      continue;
    }

    if (entry.userId === userId || pairing.has(entry.userId)) {
      continue;
    }

    if (entry.timeControl !== want) {
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

/* ------------------------------------------------------------------------- *
 * The public API. Async in both backends, so a caller never has to know which
 * one is behind it.
 * ------------------------------------------------------------------------- */

/**
 * Redis is an availability dependency for matchmaking, not an optimization the
 * way the read cache is — falling back to the in-process queue mid-request
 * would silently split the queue again, and pair nobody. A failure is surfaced
 * as a failed poll; the client polls again in two seconds.
 */
export async function heartbeat(
  userId: string,
  timeControl: QueueTimeControl = null,
  now: number = Date.now(),
): Promise<void> {
  const want = label(timeControl);

  if (!redis) {
    localHeartbeat(userId, want, now);
    return;
  }

  await redis.eval(HEARTBEAT_SCRIPT, KEYS, [userId, want, String(now)]);
}

/**
 * Take the longest-waiting live player other than `userId` out of the queue,
 * marking both sides as mid-pairing. Returns null when nobody suitable is
 * waiting.
 *
 * The caller owns the follow-through: create the game row, then call
 * `completePairing` (in a finally) so a failed create returns both players to
 * circulation instead of stranding them.
 */
export async function takePartner(
  userId: string,
  timeControl: QueueTimeControl = null,
  now: number = Date.now(),
): Promise<string | null> {
  const want = label(timeControl);

  if (!redis) {
    return localTakePartner(userId, want, now);
  }

  const partner = await redis.eval<string[], string>(
    TAKE_PARTNER_SCRIPT,
    KEYS,
    [
      userId,
      want,
      String(now),
      String(QUEUE_STALE_MS),
      String(PAIRING_TTL_MS),
      PAIRING_PREFIX,
    ],
  );

  return partner === "" ? null : partner;
}

/** Whether a game row is being created for this player right now. */
export async function isPairing(userId: string): Promise<boolean> {
  if (!redis) {
    return pairing.has(userId);
  }

  return (await redis.exists(`${PAIRING_PREFIX}${userId}`)) === 1;
}

/** Release players from the mid-pairing marker, whatever the create's fate. */
export async function completePairing(...userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    return;
  }

  if (!redis) {
    for (const userId of userIds) {
      pairing.delete(userId);
    }
    return;
  }

  await redis.del(...userIds.map((userId) => `${PAIRING_PREFIX}${userId}`));
}

/** Leave the queue. A no-op for players not in it, so a retry costs nothing. */
export async function leave(userId: string): Promise<void> {
  if (!redis) {
    queue.delete(userId);
    return;
  }

  // Pipelined: three round trips to Upstash for one departure would be three
  // times the latency on a keypress that should feel instant.
  await redis
    .pipeline()
    .zrem(QUEUE_KEY, userId)
    .zrem(SEEN_KEY, userId)
    .hdel(CLOCK_KEY, userId)
    .exec();
}

/** Empty everything. For tests only. */
export async function reset(): Promise<void> {
  queue.clear();
  pairing.clear();

  if (redis) {
    await redis.del(QUEUE_KEY, SEEN_KEY, CLOCK_KEY);
  }
}
