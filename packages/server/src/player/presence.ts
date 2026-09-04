import { db } from "@openchess/database/client";

const ONLINE_WINDOW_MS = 5 * 60_000;

const WRITE_INTERVAL_MS = 60_000;

const written = new Map<string, number>();

const SWEEP_THRESHOLD = 10_000;

function sweep(now: number): void {
  for (const [userId, at] of written) {
    if (now - at > WRITE_INTERVAL_MS) {
      written.delete(userId);
    }
  }
}

export async function touchPresence(userId: string): Promise<void> {
  const now = Date.now();
  const last = written.get(userId);

  if (last !== undefined && now - last < WRITE_INTERVAL_MS) {
    return;
  }

  if (written.size >= SWEEP_THRESHOLD) {
    sweep(now);
  }

  written.set(userId, now);

  try {
    await db.user.update({
      where: { id: userId },
      data: { lastSeenAt: new Date(now) },
    });
  } catch {}
}

export type PresenceState = "playing" | "online" | "offline";

export type PresenceView = {
  state: PresenceState;
  lastSeenAt: string | null;
};

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
    state: !isOnline(lastSeenAt, now)
      ? "offline"
      : inGame
        ? "playing"
        : "online",
    lastSeenAt: lastSeenAt?.toISOString() ?? null,
  };
}

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
    if (row.whitePlayerId !== null && wanted.has(row.whitePlayerId)) {
      playing.add(row.whitePlayerId);
    }
    if (row.blackPlayerId !== null && wanted.has(row.blackPlayerId)) {
      playing.add(row.blackPlayerId);
    }
  }

  return playing;
}

export async function presenceFor(
  players: Array<{ id: string; lastSeenAt: Date | null }>,
): Promise<Map<string, PresenceView>> {
  const now = Date.now();

  const present = players.filter((player) => isOnline(player.lastSeenAt, now));
  const playing = await playingNow(present.map((player) => player.id));

  return new Map(
    players.map((player) => [
      player.id,
      presenceOf(player.lastSeenAt, playing.has(player.id), now),
    ]),
  );
}
