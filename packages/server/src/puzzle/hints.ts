import { redis } from "../lib/upstash";

/**
 * Which puzzles a player has taken the hint on.
 *
 * A hinted solve pays half and moves the rating half as far, so "was this
 * hinted?" decides money — and a client that simply reports it would be
 * deciding its own payout. The hint endpoint is the only way to get a hint, so
 * the server records the fact there and the settle reads it back, taking a hint
 * as used if *either* side says so.
 *
 * Same two-tier shape as the matchmaking queue: Redis when it is configured, an
 * in-process map otherwise. A lost mark costs a player half a payout they were
 * not owed, which is the right direction for the failure to fall.
 */

/** Long enough to outlive any honest attempt, short enough to collect itself. */
const HINT_TTL_SECONDS = 60 * 60;
const HINT_TTL_MS = HINT_TTL_SECONDS * 1000;

/** In-process fallback: key -> expiry timestamp. */
const local = new Map<string, number>();

function key(userId: string, puzzleId: string): string {
  return `puzzle:hint:${userId}:${puzzleId}`;
}

/** Drop expired entries. Cheap, and only ever runs on the fallback path. */
function sweep(now: number): void {
  for (const [entry, expiresAt] of local) {
    if (expiresAt <= now) {
      local.delete(entry);
    }
  }
}

/** Record that this player has seen the hint for this puzzle. */
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
  } catch {
    // The in-process mark above still covers the single-instance case, and the
    // settle also honours the client's own report.
  }
}

/** Whether this player took the hint on this puzzle. */
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

/** Forget the mark once the puzzle has settled; it can never apply again. */
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
  } catch {
    // It expires on its own.
  }
}
