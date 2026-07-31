import { db } from "@openchess/database/client";

/**
 * Who is around.
 *
 * Presence here is derived, not declared: there is no "go online" call and no
 * connection to hold open. A player who makes an authenticated request has been
 * seen, `User.lastSeenAt` records when, and everything else is arithmetic
 * against that one column. Nothing needs cleaning up when a terminal is closed
 * — a client that stops making requests goes quiet on its own, which is the
 * behaviour a declared presence flag has to be given a heartbeat and a sweeper
 * to imitate.
 *
 * The cost of that is a write on the request path, so there are two guards.
 * `touchPresence` writes at most once a minute per player, and it is never
 * awaited by the middleware that calls it: presence is decoration, and a failed
 * write must not turn a good request into a failed one. The worst case of both
 * guards failing at once is a friend who reads as idle for a minute.
 */

/**
 * How long after their last request a player still counts as online.
 *
 * Comfortably more than `WRITE_INTERVAL_MS`, and that relationship is the
 * important one: a player quietly sitting on a screen that polls is refreshed
 * once a minute, so a window at or near the write interval would flicker them
 * offline between two writes that were both on time.
 */
const ONLINE_WINDOW_MS = 5 * 60_000;

/**
 * How often a player's `lastSeenAt` is actually written.
 *
 * Presence is only ever read at minute resolution, so writing on every request
 * would buy nothing and cost a row update per move. The throttle is per process
 * and deliberately not shared: two instances each writing once a minute for the
 * same player is still two writes a minute, which is nothing, and coordinating
 * them through Redis would cost a round trip to save a write we do not mind.
 */
const WRITE_INTERVAL_MS = 60_000;

/**
 * Last write per user, this process. Bounded by sweeping rather than by an LRU:
 * the entries are two numbers, and a server with enough distinct players in a
 * minute to make this map interesting has bigger costs elsewhere.
 */
const written = new Map<string, number>();

/** Sweep once the map is larger than any plausible live player count. */
const SWEEP_THRESHOLD = 10_000;

function sweep(now: number): void {
  for (const [userId, at] of written) {
    if (now - at > WRITE_INTERVAL_MS) {
      written.delete(userId);
    }
  }
}

/**
 * Record that `userId` is here, at most once every `WRITE_INTERVAL_MS`.
 *
 * Never throws, and callers should not await it — see the module comment. It
 * returns a promise only so tests can wait for the write they provoked.
 */
export async function touchPresence(userId: string): Promise<void> {
  const now = Date.now();
  const last = written.get(userId);

  if (last !== undefined && now - last < WRITE_INTERVAL_MS) {
    return;
  }

  if (written.size >= SWEEP_THRESHOLD) {
    sweep(now);
  }

  // Recorded before the write, not after: two concurrent requests from the same
  // player must not both decide they are the one to write. A write that then
  // fails costs this player a minute of looking idle, which is the cheaper of
  // the two mistakes.
  written.set(userId, now);

  try {
    await db.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date(now) },
    });
  } catch {
    // A player whose row has just been deleted, or a database having a bad
    // moment. Neither is worth failing the request that provoked this.
  }
}

/**
 * What a player is doing, as far as anyone else can tell.
 *
 * `playing` outranks `online` because it is the more useful answer to the
 * question actually being asked — a friend list exists to find someone to play,
 * and "already in a game" is the one status that tells you not to bother yet.
 */
export type PresenceState = "playing" | "online" | "offline";

export type PresenceView = {
  state: PresenceState;
  /** When they were last seen, or null for an account never seen since the column existed. */
  lastSeenAt: string | null;
};

/** Whether `lastSeenAt` is recent enough to call online. */
export function isOnline(
  lastSeenAt: Date | null,
  now: number = Date.now(),
): boolean {
  return lastSeenAt !== null && now - lastSeenAt.getTime() < ONLINE_WINDOW_MS;
}

export function presenceOf(
  lastSeenAt: Date | null,
  inGame: boolean,
  now: number = Date.now(),
): PresenceView {
  return {
    // Being in a live game does not make someone present: a game sits unfinished
    // for as long as nobody resigns it, and reporting a player who walked away
    // mid-game as "playing" forever is exactly the stale flag this module exists
    // to avoid. So the clock decides whether they are here at all, and the game
    // only decides what they are doing while they are.
    state: !isOnline(lastSeenAt, now)
      ? "offline"
      : inGame
        ? "playing"
        : "online",
    lastSeenAt: lastSeenAt?.toISOString() ?? null,
  };
}

/**
 * Which of `userIds` are in an unfinished online game right now.
 *
 * One query for the whole set rather than one per player: a friend list resolves
 * presence for every row it shows, and a per-row query would make that list
 * quadratic in nothing but its own length.
 */
export async function playingNow(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) {
    return new Set();
  }

  const rows = await db.game.findMany({
    where: {
      mode: "PVP",
      endedAt: null,
      OR: [
        { whitePlayerId: { in: userIds } },
        { blackPlayerId: { in: userIds } },
      ],
    },
    select: { whitePlayerId: true, blackPlayerId: true },
  });

  const playing = new Set<string>();
  const wanted = new Set(userIds);

  for (const row of rows) {
    // Both sides are checked against `wanted`: the query matches a game if
    // *either* player is in the set, so the opponent comes back attached to it
    // and would otherwise be marked as playing without ever being asked about.
    if (row.whitePlayerId !== null && wanted.has(row.whitePlayerId)) {
      playing.add(row.whitePlayerId);
    }
    if (row.blackPlayerId !== null && wanted.has(row.blackPlayerId)) {
      playing.add(row.blackPlayerId);
    }
  }

  return playing;
}

/** Presence for a set of players, resolved in one pass. */
export async function presenceFor(
  players: Array<{ id: string; lastSeenAt: Date | null }>,
): Promise<Map<string, PresenceView>> {
  const now = Date.now();

  // Only players who are here at all can be playing, so the game query is
  // narrowed to them first — on a large friend list that is most of the rows
  // removed before the database is asked anything.
  const present = players.filter((player) => isOnline(player.lastSeenAt, now));
  const playing = await playingNow(present.map((player) => player.id));

  return new Map(
    players.map((player) => [
      player.id,
      presenceOf(player.lastSeenAt, playing.has(player.id), now),
    ]),
  );
}
