import type {
  Difficulty,
  Game as GameRow,
  GameResult,
  GameVariant,
  User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  capturedPieces,
  materialBalance,
  toFen,
  type Color,
  type Game,
  type PersonalityId,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../../lib/problem-details";
import { botFor, toOfferColor } from "../rules";
import {
  type ClockView,
  type OpponentView,
  type TimeControlView,
  clockView,
  colorOf,
  replay,
  timeControlView,
} from "./views";
import { loadFor } from "./loading";

export type GameSummary = {
  id: string;
  mode: GameRow["mode"];
  variant: GameVariant;
  difficulty: Difficulty | null;
  personality: PersonalityId | null;
  yourColor: Color;
  result: GameResult | null;
  ply: number;
  startedAt: string;
  endedAt: string | null;
};

function summarize(row: GameRow, userId: string): GameSummary {
  return {
    id: row.id,
    mode: row.mode,
    variant: row.variant,
    difficulty: row.difficulty,
    personality: row.mode === "AI" ? botFor(row).id : null,
    // Every row we list here was queried by this user's own id on one side or
    // the other, so the color is never actually null.
    yourColor: colorOf(row, userId) ?? "w",
    result: row.result,
    ply: row.moves.length,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

/** The caller's finished games, newest first, cursor-paginated on `(endedAt, id)`. */
export async function listGames(input: {
  user: User;
  limit: number;
  cursor?: { ts: Date; id: string };
  result?: GameResult;
}): Promise<{ games: GameSummary[]; nextCursor: string | null }> {
  const rows = await db.game.findMany({
    where: {
      OR: [{ whitePlayerId: input.user.id }, { blackPlayerId: input.user.id }],
      endedAt: { not: null },
      ...(input.result ? { result: input.result } : {}),
      // Strictly after the cursor row in `(endedAt, id)` order: ties on the
      // timestamp fall through to the id, so rows that settled in the same
      // instant are never skipped at a page boundary.
      ...(input.cursor
        ? {
            AND: [
              {
                OR: [
                  { endedAt: { lt: input.cursor.ts } },
                  { endedAt: input.cursor.ts, id: { lt: input.cursor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ endedAt: "desc" }, { id: "desc" }],
    // One extra row tells us whether another page exists without a second query.
    take: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const last = rows.length > input.limit ? page[page.length - 1] : null;

  return {
    games: page.map((row) => summarize(row, input.user.id)),
    // The `<iso>_<id>` compound `paginationQuerySchema` validates and
    // `decodeCursor` splits. Opaque to clients, which round-trip it verbatim.
    nextCursor: last?.endedAt
      ? `${last.endedAt.toISOString()}_${last.id}`
      : null,
  };
}

/**
 * The archival PGN of a finished game the caller played.
 *
 * Read off the row rather than rebuilt: `claimGame` wrote it at settlement with
 * the players' names as they stood then, and regenerating it here would quietly
 * rename anyone who has changed their username since.
 */
export async function getGamePgn(
  gameId: string,
  user: User,
): Promise<{ pgn: string; filename: string }> {
  const { row, game } = await loadFor(db, gameId, user.id);

  if (row.pgn === null) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "This game is still going. There is a PGN once it is over.",
    );
  }

  const date = row.startedAt.toISOString().slice(0, 10);

  return {
    pgn: row.pgn,
    // Enough to tell two downloads apart in a folder, and safe as a filename on
    // every platform without escaping.
    filename: `openchess-${date}-${row.id.slice(-6)}-${game.history.length}ply.pgn`,
  };
}

export type SpectatorView = {
  id: string;
  white: OpponentView | null;
  black: OpponentView | null;
  variant: GameVariant;
  /** The array it began from; see `GameView.startFen`. */
  startFen: string | null;
  fen: string;
  turn: Color;
  status: Game["status"];
  ply: number;
  history: string[];
  captured: { byWhite: string[]; byBlack: string[] };
  materialBalance: number;
  result: GameResult | null;
  timeControl: TimeControlView | null;
  clock: ClockView | null;
  /**
   * The side with a draw offer standing, or null when none is. A watcher can see
   * one for the same reason they can see the clock: it is part of what is
   * happening on a public board, and "Black has offered a draw" is half the story
   * of the next move. There is still nothing here to act on.
   */
  drawOfferFrom: Color | null;
  /** A standing takeback offer, shown for the same reason the draw offer is. */
  takebackOfferFrom: Color | null;
  startedAt: string;
  endedAt: string | null;
};

/** Both players' public faces, for a board nobody watching is playing on. */
async function playersOf(
  row: GameRow,
): Promise<{ white: OpponentView | null; black: OpponentView | null }> {
  const ids = [row.whitePlayerId, row.blackPlayerId].filter(
    (id): id is string => id !== null,
  );

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      username: true,
      equippedTitle: { select: { label: true } },
    },
  });

  const byId = new Map(
    users.map((user) => [
      user.id,
      { username: user.username, title: user.equippedTitle?.label ?? null },
    ]),
  );

  return {
    white: row.whitePlayerId ? (byId.get(row.whitePlayerId) ?? null) : null,
    black: row.blackPlayerId ? (byId.get(row.blackPlayerId) ?? null) : null,
  };
}

function spectatorView(
  row: GameRow,
  game: Game,
  players: { white: OpponentView | null; black: OpponentView | null },
): SpectatorView {
  const captured = capturedPieces(game);

  return {
    id: row.id,
    white: players.white,
    black: players.black,
    variant: row.variant,
    startFen: row.startFen,
    fen: toFen(game.position),
    turn: game.position.turn,
    status: game.status,
    ply: game.history.length,
    history: game.history.map((entry) => entry.san),
    captured: { byWhite: captured.byWhite, byBlack: captured.byBlack },
    materialBalance: materialBalance(game.position),
    result: row.result,
    timeControl: timeControlView(row),
    clock: clockView(row, game),
    drawOfferFrom: toOfferColor(row.drawOfferedBy),
    takebackOfferFrom: toOfferColor(row.takebackOfferedBy),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

/**
 * Watch a game you are not playing in.
 *
 * Deliberately a different shape from `GameView` rather than the same one with
 * fields blanked: a spectator has no colour, no legal moves and no rewards, and
 * handing them a view that claims otherwise would invite a client to offer
 * actions the server will refuse. There is nothing here a player could not
 * already see — an online game is public while it is being played — and the
 * legal-move list, the one thing a watcher could use to play someone else's
 * board, is simply absent.
 *
 * Only PvP games can be watched. An AI game is a private practice board; the
 * bot has no audience and its human did not sign up for one.
 */
export async function watchGame(gameId: string): Promise<SpectatorView> {
  const row = await db.game.findUnique({ where: { id: gameId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  if (row.mode !== "PVP") {
    throwProblem(HttpStatusCodes.FORBIDDEN, "Only online games can be watched");
  }

  return spectatorView(row, replay(row), await playersOf(row));
}

export type LiveGameSummary = {
  id: string;
  white: OpponentView | null;
  black: OpponentView | null;
  /** The two players' ratings, for sorting the list by how good the game is. */
  whiteRating: number | null;
  blackRating: number | null;
  ply: number;
  timeControl: TimeControlView | null;
  startedAt: string;
};

/** How many live games the watch list will show at once. */
const MAX_LIVE_GAMES = 30;

/**
 * The games being played right now, best first.
 *
 * "Best" is the lower of the two ratings: a 2000 playing an 800 is a less
 * interesting board than two 1500s, and ranking on the average would put it
 * above them. Games that have not started — paired but with no move played —
 * are left out; there is nothing to watch yet, and half of them are abandoned
 * pairings that will be aborted.
 */
export async function listLiveGames(): Promise<LiveGameSummary[]> {
  const rows = await db.game.findMany({
    where: { mode: "PVP", endedAt: null },
    orderBy: { startedAt: "desc" },
    // Over-fetched: the ply filter and the rating sort both happen below, and a
    // window this size covers any plausible number of concurrent games.
    take: MAX_LIVE_GAMES * 4,
    include: {
      whitePlayer: {
        select: {
          username: true,
          equippedTitle: { select: { label: true } },
          stats: { select: { rating: true } },
        },
      },
      blackPlayer: {
        select: {
          username: true,
          equippedTitle: { select: { label: true } },
          stats: { select: { rating: true } },
        },
      },
    },
  });

  const face = (
    player: {
      username: string;
      equippedTitle: { label: string } | null;
    } | null,
  ): OpponentView | null =>
    player
      ? {
          username: player.username,
          title: player.equippedTitle?.label ?? null,
        }
      : null;

  return rows
    .filter((row) => row.moves.length > 0)
    .map((row) => ({
      id: row.id,
      white: face(row.whitePlayer),
      black: face(row.blackPlayer),
      whiteRating: row.whitePlayer?.stats?.rating ?? null,
      blackRating: row.blackPlayer?.stats?.rating ?? null,
      ply: row.moves.length,
      timeControl: timeControlView(row),
      startedAt: row.startedAt.toISOString(),
    }))
    .sort((a, b) => {
      const strength = (game: LiveGameSummary) =>
        Math.min(game.whiteRating ?? 0, game.blackRating ?? 0);
      return strength(b) - strength(a);
    })
    .slice(0, MAX_LIVE_GAMES);
}

/** Games still in progress. Lets a client offer "resume" instead of stranding rows. */
export async function listActiveGames(user: User): Promise<GameSummary[]> {
  const rows = await db.game.findMany({
    where: {
      OR: [{ whitePlayerId: user.id }, { blackPlayerId: user.id }],
      endedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });

  return rows.map((row) => summarize(row, user.id));
}
