import type { GameResult, User } from "@openchess/database";
import { db } from "@openchess/database/client";
import { levelProgress } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { normalizeUsername } from "../lib/users";
import { friendshipWith, type FriendshipState } from "./friends";
import { presenceFor, type PresenceView } from "./presence";

const RECENT_GAMES = 8;

const CURVE_POINTS = 20;

const RECENT_ACHIEVEMENTS = 3;

export type ProfileGameView = {
  id: string;
  mode: "AI" | "PVP";
  opponent: string | null;
  outcome: "win" | "loss" | "draw" | "aborted";
  result: GameResult;
  ply: number;
  endedAt: string;
};

export type PublicProfile = {
  id: string;
  username: string;
  title: string | null;
  level: number;
  experience: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  rating: number;
  peakRating: number | null;
  puzzleRating: number;
  puzzlesSolved: number;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  topWinStreak: number;
  topLoginStreak: number;
  achievementsUnlocked: number;
  recentAchievements: Array<{ code: string; name: string; unlockedAt: string }>;
  ratingHistory: number[];
  recentGames: ProfileGameView[];
  presence: PresenceView;
  friendship: { state: FriendshipState; friendshipId: string | null };
  joinedAt: string;
};

function outcomeFor(
  result: GameResult,
  playedWhite: boolean,
): ProfileGameView["outcome"] {
  if (result === "ABORTED") {
    return "aborted";
  }
  if (result === "DRAW") {
    return "draw";
  }
  return (result === "WHITE_WIN") === playedWhite ? "win" : "loss";
}

async function findByUsername(username: string) {
  return db.user.findUnique({
    where: { username: normalizeUsername(username) },
    select: {
      id: true,
      username: true,
      level: true,
      experience: true,
      createdAt: true,
      lastSeenAt: true,
      equippedTitle: { select: { label: true } },
      stats: true,
    },
  });
}

export async function getPublicProfile(input: {
  user: User;
  username: string;
}): Promise<PublicProfile> {
  const row = await findByUsername(input.username);

  if (!row) {
    throwProblem(
      HttpStatusCodes.NOT_FOUND,
      `No player called "${input.username}"`,
    );
  }

  const [presence, friendship, curve, peak, games, unlocked, achievementCount] =
    await Promise.all([
      presenceFor([{ id: row.id, lastSeenAt: row.lastSeenAt }]),
      friendshipWith(input.user, row.id),
      db.ratingSnapshot.findMany({
        where: { userId: row.id },
        orderBy: { createdAt: "desc" },
        take: CURVE_POINTS,
        select: { rating: true, delta: true },
      }),
      db.ratingSnapshot.aggregate({
        where: { userId: row.id },
        _max: { rating: true },
      }),
      db.game.findMany({
        where: {
          endedAt: { not: null },
          result: { not: null },
          OR: [{ whitePlayerId: row.id }, { blackPlayerId: row.id }],
        },
        orderBy: { endedAt: "desc" },
        take: RECENT_GAMES,
        select: {
          id: true,
          mode: true,
          personality: true,
          result: true,
          moves: true,
          endedAt: true,
          whitePlayerId: true,
          whitePlayer: { select: { username: true } },
          blackPlayer: { select: { username: true } },
        },
      }),
      db.userAchievement.findMany({
        where: { userId: row.id, achievement: { secret: false } },
        orderBy: { unlockedAt: "desc" },
        take: RECENT_ACHIEVEMENTS,
        select: {
          unlockedAt: true,
          achievement: { select: { code: true, name: true } },
        },
      }),
      db.userAchievement.count({ where: { userId: row.id } }),
    ]);

  const progress = levelProgress(row.experience);

  const points = [...curve].reverse();
  const oldest = points[0];

  return {
    id: row.id,
    username: row.username,
    title: row.equippedTitle?.label ?? null,
    level: progress.level,
    experience: row.experience,
    xpIntoLevel: progress.xpIntoLevel,
    xpToNextLevel: progress.xpToNextLevel,
    rating: row.stats?.rating ?? 0,
    peakRating: peak._max.rating,
    puzzleRating: row.stats?.puzzleRating ?? 0,
    puzzlesSolved: row.stats?.puzzlesSolved ?? 0,
    wins: row.stats?.wins ?? 0,
    losses: row.stats?.losses ?? 0,
    draws: row.stats?.draws ?? 0,
    currentWinStreak: row.stats?.currentWinStreak ?? 0,
    topWinStreak: row.stats?.topWinStreak ?? 0,
    topLoginStreak: row.stats?.topLoginStreak ?? 0,
    achievementsUnlocked: achievementCount,
    recentAchievements: unlocked.map((entry) => ({
      code: entry.achievement.code,
      name: entry.achievement.name,
      unlockedAt: entry.unlockedAt.toISOString(),
    })),
    ratingHistory:
      oldest === undefined
        ? []
        : [
            oldest.rating - oldest.delta,
            ...points.map((point) => point.rating),
          ],
    recentGames: games.map((game) => {
      const playedWhite = game.whitePlayerId === row.id;

      return {
        id: game.id,
        mode: game.mode,
        opponent:
          game.mode === "AI"
            ? game.personality
            : ((playedWhite ? game.blackPlayer : game.whitePlayer)?.username ??
              null),
        outcome: outcomeFor(game.result!, playedWhite),
        result: game.result!,
        ply: game.moves.length,
        endedAt: game.endedAt!.toISOString(),
      };
    }),
    presence: presence.get(row.id) ?? { state: "offline", lastSeenAt: null },
    friendship,
    joinedAt: row.createdAt.toISOString(),
  };
}

const SEARCH_LIMIT = 10;

export type PlayerSearchResult = {
  userId: string;
  username: string;
  title: string | null;
  level: number;
  rating: number;
  presence: PresenceView;
  friendship: FriendshipState;
};

export async function searchPlayers(input: {
  user: User;
  query: string;
  limit?: number;
}): Promise<PlayerSearchResult[]> {
  const query = normalizeUsername(input.query);

  if (query.length === 0) {
    return [];
  }

  const rows = await db.user.findMany({
    where: {
      username: { startsWith: query },
      id: { not: input.user.id },
    },
    orderBy: { username: "asc" },
    take: Math.min(input.limit ?? SEARCH_LIMIT, SEARCH_LIMIT),
    select: {
      id: true,
      username: true,
      level: true,
      lastSeenAt: true,
      equippedTitle: { select: { label: true } },
      stats: { select: { rating: true } },
    },
  });

  if (rows.length === 0) {
    return [];
  }

  const ids = rows.map((row) => row.id);

  const [presence, standings] = await Promise.all([
    presenceFor(
      rows.map((row) => ({ id: row.id, lastSeenAt: row.lastSeenAt })),
    ),
    db.friendship.findMany({
      where: {
        OR: [
          { requesterId: input.user.id, addresseeId: { in: ids } },
          { addresseeId: input.user.id, requesterId: { in: ids } },
        ],
      },
      select: { requesterId: true, addresseeId: true, status: true },
    }),
  ]);

  const standingByUser = new Map<string, FriendshipState>();

  for (const row of standings) {
    const them =
      row.requesterId === input.user.id ? row.addresseeId : row.requesterId;

    standingByUser.set(
      them,
      row.status === "ACCEPTED"
        ? "friends"
        : row.status === "DECLINED"
          ? "none"
          : row.requesterId === input.user.id
            ? "requestSent"
            : "requestReceived",
    );
  }

  return rows.map((row) => ({
    userId: row.id,
    username: row.username,
    title: row.equippedTitle?.label ?? null,
    level: row.level,
    rating: row.stats?.rating ?? 0,
    presence: presence.get(row.id) ?? { state: "offline", lastSeenAt: null },
    friendship: standingByUser.get(row.id) ?? "none",
  }));
}
