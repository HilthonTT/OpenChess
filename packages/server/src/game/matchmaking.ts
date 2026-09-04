import { redis } from "../lib/upstash";

export type QueueTimeControl = string | null;

export const QUEUE_STALE_MS = 10_000;

const PAIRING_TTL_MS = 15_000;

const UNTIMED = "untimed";

function label(timeControl: QueueTimeControl): string {
  return timeControl ?? UNTIMED;
}

const QUEUE_KEY = "mm:{mm}:queue";
const SEEN_KEY = "mm:{mm}:seen";
const CLOCK_KEY = "mm:{mm}:clock";
const PAIRING_PREFIX = "mm:{mm}:pairing:";

const KEYS = [QUEUE_KEY, SEEN_KEY, CLOCK_KEY];

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

type Entry = {
  userId: string;
  timeControl: string;
  enqueuedAt: number;
  lastSeenAt: number;
};

const queue = new Map<string, Entry>();

const pairing = new Set<string>();

function localHeartbeat(userId: string, want: string, now: number): void {
  const entry = queue.get(userId);

  if (entry && entry.timeControl === want) {
    entry.lastSeenAt = now;
    return;
  }

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

export async function isPairing(userId: string): Promise<boolean> {
  if (!redis) {
    return pairing.has(userId);
  }

  return (await redis.exists(`${PAIRING_PREFIX}${userId}`)) === 1;
}

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

export async function leave(userId: string): Promise<void> {
  if (!redis) {
    queue.delete(userId);
    return;
  }

  await redis
    .pipeline()
    .zrem(QUEUE_KEY, userId)
    .zrem(SEEN_KEY, userId)
    .hdel(CLOCK_KEY, userId)
    .exec();
}

export async function reset(): Promise<void> {
  queue.clear();
  pairing.clear();

  if (redis) {
    await redis.del(QUEUE_KEY, SEEN_KEY, CLOCK_KEY);
  }
}
