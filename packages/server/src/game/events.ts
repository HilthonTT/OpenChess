import { redis } from "../lib/upstash";

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeToGame(
  gameId: string,
  listener: Listener,
): () => void {
  const forGame = listeners.get(gameId) ?? new Set<Listener>();
  forGame.add(listener);
  listeners.set(gameId, forGame);

  return () => {
    forGame.delete(listener);
    if (forGame.size === 0) {
      listeners.delete(gameId);
    }
  };
}

const VERSION_TTL_SECONDS = 24 * 60 * 60;

function versionKey(gameId: string): string {
  return `game:ver:${gameId}`;
}

export function publishGameChanged(gameId: string): void {
  for (const listener of listeners.get(gameId) ?? []) {
    try {
      listener();
    } catch {}
  }

  if (!redis) {
    return;
  }

  void redis
    .pipeline()
    .incr(versionKey(gameId))
    .expire(versionKey(gameId), VERSION_TTL_SECONDS)
    .exec()
    .catch(() => {});
}

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
