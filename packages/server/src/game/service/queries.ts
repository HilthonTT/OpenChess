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
    yourColor: colorOf(row, userId) ?? "w",
    result: row.result,
    ply: row.moves.length,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

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
    take: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const last = rows.length > input.limit ? page[page.length - 1] : null;

  return {
    games: page.map((row) => summarize(row, input.user.id)),
    nextCursor: last?.endedAt
      ? `${last.endedAt.toISOString()}_${last.id}`
      : null,
  };
}

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
    filename: `openchess-${date}-${row.id.slice(-6)}-${game.history.length}ply.pgn`,
  };
}

export type SpectatorView = {
  id: string;
  white: OpponentView | null;
  black: OpponentView | null;
  variant: GameVariant;
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
  drawOfferFrom: Color | null;
  takebackOfferFrom: Color | null;
  startedAt: string;
  endedAt: string | null;
};

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
  whiteRating: number | null;
  blackRating: number | null;
  ply: number;
  timeControl: TimeControlView | null;
  startedAt: string;
};

const MAX_LIVE_GAMES = 30;

export async function listLiveGames(): Promise<LiveGameSummary[]> {
  const rows = await db.game.findMany({
    where: { mode: "PVP", endedAt: null },
    orderBy: { startedAt: "desc" },
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
