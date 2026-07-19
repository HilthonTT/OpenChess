import { redis } from "./upstash";

/**
 * A read-through cache over Upstash Redis, with namespace-level invalidation.
 *
 * Invalidation is by versioning, not deletion: each namespace has a version
 * counter, and every cached value lives under a key embedding the current
 * version. `invalidateCache` bumps the counter — one O(1) INCR — after which
 * every reader computes a new key and misses. The orphaned entries are never
 * enumerated; their TTLs collect them. On Upstash, where every command is a
 * paid REST round trip, this is what keeps invalidation a single call instead
 * of a SCAN-and-delete.
 *
 * The TTL is also the staleness ceiling: if an invalidation bump is ever lost
 * (Redis unreachable at the moment of a write), the stale value can outlive it
 * by at most `ttlSeconds`. Keep TTLs short accordingly.
 *
 * The cache is strictly an optimization. With no Redis configured, or with
 * Redis failing mid-request, every call degrades to the loader — nothing here
 * may turn a cache problem into a request failure.
 */

export type CacheNamespace = "leaderboard" | "titles" | "achievements";

function versionKey(namespace: CacheNamespace): string {
  return `cache:${namespace}:version`;
}

function warn(action: string, error: unknown): void {
  console.warn(
    `Cache ${action} failed, serving without it: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
}

/**
 * Read `key` from `namespace`, filling it from `load` on a miss.
 *
 * `load`'s result must be JSON-safe and non-null: values round-trip through
 * JSON (a `Date` comes back a string — cache projections, not rows), and
 * `null` is indistinguishable from a miss.
 */
export async function cached<T>(
  namespace: CacheNamespace,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  if (!redis) {
    return load();
  }

  let dataKey: string | null = null;

  try {
    const version = (await redis.get<number>(versionKey(namespace))) ?? 0;
    dataKey = `cache:${namespace}:${version}:${key}`;

    const hit = await redis.get<T>(dataKey);
    if (hit !== null) {
      return hit;
    }
  } catch (error) {
    warn("read", error);
    // Redis is failing right now; do not follow the load with a write to it.
    dataKey = null;
  }

  const value = await load();

  if (dataKey !== null) {
    try {
      await redis.set(dataKey, value, { ex: ttlSeconds });
    } catch (error) {
      warn("write", error);
    }
  }

  return value;
}

/** Drop every cached value in `namespace`, effective immediately. */
export async function invalidateCache(
  namespace: CacheNamespace,
): Promise<void> {
  if (!redis) {
    return;
  }

  try {
    await redis.incr(versionKey(namespace));
  } catch (error) {
    warn("invalidation", error);
  }
}
