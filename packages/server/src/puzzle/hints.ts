import { redis } from "../lib/upstash";

const HINT_TTL_SECONDS = 60 * 60;
const HINT_TTL_MS = HINT_TTL_SECONDS * 1000;

const local = new Map<string, number>();

function key(userId: string, puzzleId: string): string {
  return `puzzle:hint:${userId}:${puzzleId}`;
}

function sweep(now: number): void {
  for (const [entry, expiresAt] of local) {
    if (expiresAt <= now) {
      local.delete(entry);
    }
  }
}

export async function markHintUsed(
  userId: string,
  puzzleId: string,
): Promise<void> {
  const now = Date.now();
  sweep(now);
  local.set(key(userId, puzzleId), now + HINT_TTL_MS);

  if (!redis) {
    return;
  }

  try {
    await redis.set(key(userId, puzzleId), 1, { ex: HINT_TTL_SECONDS });
  } catch {}
}

export async function wasHintUsed(
  userId: string,
  puzzleId: string,
): Promise<boolean> {
  const entry = local.get(key(userId, puzzleId));
  if (entry !== undefined && entry > Date.now()) {
    return true;
  }

  if (!redis) {
    return false;
  }

  try {
    return (await redis.get(key(userId, puzzleId))) !== null;
  } catch {
    return false;
  }
}

export async function clearHint(
  userId: string,
  puzzleId: string,
): Promise<void> {
  local.delete(key(userId, puzzleId));

  if (!redis) {
    return;
  }

  try {
    await redis.del(key(userId, puzzleId));
  } catch {}
}
