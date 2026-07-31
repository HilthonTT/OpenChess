import { type GameResult, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import { levelProgress } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { normalizeUsername } from "../lib/users";
import { friendshipWith, type FriendshipState } from "./friends";
import { presenceFor, type PresenceView } from "./presence";

/**
 * Other players, as seen from outside.
 *
 * Everything here is deliberately a *subset* of what `/me` returns, and the
 * subset is the point. A profile carries what a player has already made public
 * by playing — their record, their rating, the title they chose to wear — and
 * nothing they have not: no wallet, no ledger, no Clerk id, no email. The way
 * that is enforced is by projecting explicitly, field by field, rather than by
 * loading the row and deleting what should not be there. A field added to
 * `User` tomorrow is invisible here until someone writes it down, which is the
 * right default for the one shape in the API that shows one player to another.
 *
 * The rest of the API already treats finished games as public — the watch list
 * shows live games to anyone signed in, and the leaderboard shows names and
 * ratings — so nothing on a profile is newly visible. It is the same facts,
 * gathered in one place.
 */

/** Recent games shown on a profile. Enough to read the shape of a run of play. */
const RECENT_GAMES = 8;

/** Rating points a profile carries, for the sparkline beside the number. */
const CURVE_POINTS = 20;

/** Unlocked achievements named on a profile, newest first. */
const RECENT_ACHIEVEMENTS = 3;

export type ProfileGameView = {
  id: string;
  mode: "AI" | "PVP";
  /** The other player, or the bot's name in an AI game. */
  opponent: string | null;
  /** The result from the profiled player's point of view. */
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
  /** Best rating ever reached, or null for a player with no rated history. */
  peakRating: number | null;
  puzzleRating: number;
  puzzlesSolved: number;
  wins: number;
  losses: number;
  draws: number;
  currentWinStreak: number;
  topWinStreak: number;
  /** The daily check-in run. The number only — never the day it was claimed. */
  topLoginStreak: number;
  achievementsUnlocked: number;
  recentAchievements: Array<{ code: string; name: string; unlockedAt: string }>;
  /** The rating curve, oldest first, for a sparkline. */
  ratingHistory: number[];
  recentGames: ProfileGameView[];
  presence: PresenceView;
  /** How the caller stands with them, and the row that changes it. */
  friendship: { state: FriendshipState; friendshipId: string | null };
  /** When they joined. Date only, to the day. */
  joinedAt: string;
};

/**
 * Which way a finished game went for `userId`.
 *
 * An aborted game is not a draw and is reported as itself: nobody's record
 * moved, and folding it into the draws column would put a game nobody played
 * onto a profile.
 */
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

/**
 * A player by name.
 *
 * The typed name is normalized rather than the comparison being made
 * case-insensitive: usernames are stored lower case, and this way the lookup is
 * an index hit on `@unique` instead of an `ILIKE` scan. See `normalizeUsername`.
 */
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
      // Secret achievements are counted but never named: the count is a score,
      // and withholding it would misreport the player's total to protect a
      // surprise the name alone is what spoils.
      db.userAchievement.count({ where: { userId: row.id } }),
    ]);

  const progress = levelProgress(row.experience);

  // Oldest first, and anchored the way the Stats screen anchors its own curve:
  // the first value is the rating *before* the window's first change, so a rise
  // that happened off the left edge is not drawn as flat.
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

/** How many players a search returns. Enough to pick from, short enough to read. */
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

/**
 * Find players by the start of their username.
 *
 * A prefix match rather than a substring one, and that is a decision rather
 * than a limitation: `contains` cannot use an index at all, so it would be a
 * sequential scan of every account — and it would also turn the search box into
 * a way to enumerate players by fishing for common letters. A prefix is what
 * someone typing a name they already know actually needs, and the
 * `text_pattern_ops` index answers it without reading the table.
 *
 * The query is lower-cased rather than compared case-insensitively, for the
 * reason spelled out on `normalizeUsername`: `ILIKE` would put that index right
 * back out of reach.
 */
export async function searchPlayers(input: {
  user: User;
  query: string;
  limit?: number;
}): Promise<PlayerSearchResult[]> {
  const query = normalizeUsername(input.query);

  // The empty prefix matches everyone; answering it would be a player dump
  // rather than a search.
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

  // Both resolved for the whole page at once. A per-row query for either would
  // make a ten-name search eleven round trips.
  const [presence, standings] = await Promise.all([
    presenceFor(rows.map((row) => ({ id: row.id, lastSeenAt: row.lastSeenAt }))),
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
          ? // A decline reads as "you may ask", exactly as it does on a profile.
            "none"
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
