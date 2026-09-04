import { redis } from "./upstash";

export type CacheNamespace =
  | "leaderboard"
  | "titles"
  | "achievements"
  | "puzzle-themes";

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
