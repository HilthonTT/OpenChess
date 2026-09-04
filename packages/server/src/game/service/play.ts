import {
  Prisma,
  type Game as GameRow,
  type GameVariant,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  createGame,
  findBestMove,
  findLegalMove,
  fromAlgebraic,
  gameMoves,
  isGameOver,
  needsPromotion,
  personalityFor,
  play,
  randomChess960Fen,
  toFen,
  TIME_CONTROLS,
  type Color,
  type PersonalityId,
  type PromotionPiece,
  type TimeControlKey,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { invalidateCache } from "../../lib/cache";
import { throwProblem } from "../../lib/problem-details";
import { publishGameChanged } from "../events";
import * as matchmaking from "../matchmaking";
import {
  clockAfterMove,
  hasFlagged,
  resultFor,
  resultForResignation,
  resultForTimeout,
  botFor,
  toOfferColor,
  toStoredDifficulty,
  type ClockState,
} from "../rules";
import { lastMoveAt, markMoved } from "./activity";
import { loadFor, opponentFor } from "./loading";
import { settle, settlePvp } from "./settlement";
import { SERIALIZATION_FAILURE, serializable } from "./transactions";
import {
  type GameView,
  type MoveView,
  clockState,
  colorOf,
  fromHistory,
  replay,
  view,
} from "./views";

const MAX_ACTIVE_GAMES = 20;

export function initialClockData(
  timeControl: TimeControlKey | null | undefined,
): {
  initialSeconds?: number;
  incrementSeconds?: number;
  whiteTimeMs?: number;
  blackTimeMs?: number;
  turnStartedAt?: Date;
} {
  if (!timeControl) {
    return {};
  }

  const preset = TIME_CONTROLS[timeControl];
  const ms = preset.initialSeconds * 1000;

  return {
    initialSeconds: preset.initialSeconds,
    incrementSeconds: preset.incrementSeconds,
    whiteTimeMs: ms,
    blackTimeMs: ms,
    turnStartedAt: new Date(),
  };
}

export async function createAiGame(input: {
  user: User;
  personality: PersonalityId;
  color: "white" | "black" | "random";
  timeControl?: TimeControlKey | null;
  variant?: GameVariant;
}): Promise<GameView> {
  const active = await db.game.count({
    where: {
      OR: [{ whitePlayerId: input.user.id }, { blackPlayerId: input.user.id }],
      endedAt: null,
    },
  });

  if (active >= MAX_ACTIVE_GAMES) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have ${active} unfinished games. Finish, resign or abort one before starting another.`,
    );
  }

  const color: Color =
    input.color === "random"
      ? Math.random() < 0.5
        ? "w"
        : "b"
      : input.color === "white"
        ? "w"
        : "b";

  const bot = personalityFor(input.personality);
  const variant: GameVariant = input.variant ?? "STANDARD";

  const startFen = variant === "CHESS960" ? randomChess960Fen() : null;

  let game = createGame(startFen ?? undefined);

  if (color === "b") {
    const opening = findBestMove(game.position, bot);
    if (opening) {
      game = play(game, opening);
    }
  }

  const row = await db.game.create({
    data: {
      mode: "AI",
      variant,
      startFen,
      difficulty: toStoredDifficulty(bot.tier),
      personality: bot.id,
      whitePlayerId: color === "w" ? input.user.id : null,
      blackPlayerId: color === "b" ? input.user.id : null,
      moves: gameMoves(game),
      currentFen: toFen(game.position),
      ...initialClockData(input.timeControl),
    },
  });

  return view(row, game, color, null);
}

export type QueueResult =
  | { status: "waiting"; game: null }
  | { status: "matched"; game: GameView };

export async function joinPvpQueue(
  user: User,
  timeControl: TimeControlKey | null = null,
): Promise<QueueResult> {
  const existing = await db.game.findFirst({
    where: {
      mode: "PVP",
      endedAt: null,
      OR: [{ whitePlayerId: user.id }, { blackPlayerId: user.id }],
    },
    orderBy: { startedAt: "desc" },
  });

  if (existing) {
    await matchmaking.leave(user.id);

    const color = colorOf(existing, user.id) ?? "w";
    const opponent = await opponentFor(db, existing, user.id);

    return {
      status: "matched",
      game: view(existing, replay(existing), color, null, opponent),
    };
  }

  if (await matchmaking.isPairing(user.id)) {
    return { status: "waiting", game: null };
  }

  const partnerId = await matchmaking.takePartner(user.id, timeControl);

  if (partnerId === null) {
    await matchmaking.heartbeat(user.id, timeControl);
    return { status: "waiting", game: null };
  }

  try {
    const partner = await db.user.findUnique({
      where: { id: partnerId },
      include: { equippedTitle: { select: { label: true } } },
    });

    if (!partner) {
      await matchmaking.heartbeat(user.id, timeControl);
      return { status: "waiting", game: null };
    }

    const userIsWhite = Math.random() < 0.5;

    let row: GameRow | null = null;
    try {
      row = await db.$transaction(
        async (tx) => {
          const clash = await tx.game.findFirst({
            where: {
              mode: "PVP",
              endedAt: null,
              OR: [
                { whitePlayerId: { in: [user.id, partner.id] } },
                { blackPlayerId: { in: [user.id, partner.id] } },
              ],
            },
          });

          if (clash) {
            return null;
          }

          return tx.game.create({
            data: {
              mode: "PVP",
              whitePlayerId: userIsWhite ? user.id : partner.id,
              blackPlayerId: userIsWhite ? partner.id : user.id,
              moves: [],
              currentFen: toFen(createGame().position),
              ...initialClockData(timeControl),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === SERIALIZATION_FAILURE
      ) {
        row = null;
      } else {
        throw error;
      }
    }

    if (row === null) {
      await matchmaking.heartbeat(user.id, timeControl);
      return { status: "waiting", game: null };
    }

    return {
      status: "matched",
      game: view(row, replay(row), userIsWhite ? "w" : "b", null, {
        username: partner.username,
        title: partner.equippedTitle?.label ?? null,
      }),
    };
  } finally {
    await matchmaking.completePairing(user.id, partnerId);
  }
}

export async function leavePvpQueue(user: User): Promise<boolean> {
  await matchmaking.leave(user.id);
  return !(await matchmaking.isPairing(user.id));
}

export async function getGame(gameId: string, user: User): Promise<GameView> {
  const { row, game, color, opponent } = await loadFor(db, gameId, user.id);
  return view(row, game, color, null, opponent);
}

export type MoveResult = {
  yourMove: MoveView;
  aiMove: MoveView | null;
  state: GameView;
};

export async function playMove(input: {
  gameId: string;
  user: User;
  from: string;
  to: string;
  promotion?: PromotionPiece;
  ply: number;
}): Promise<MoveResult> {
  const now = Date.now();

  const {
    row,
    game: loaded,
    color,
    opponent,
  } = await loadFor(db, input.gameId, input.user.id);

  if (row.endedAt !== null) {
    throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
  }

  if (input.ply !== row.moves.length) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `The board has moved on: you played from ply ${input.ply}, the game is at ply ${row.moves.length}. Refetch the game.`,
    );
  }

  if (loaded.position.turn !== color) {
    throwProblem(HttpStatusCodes.CONFLICT, "It is not your turn");
  }

  const from = fromAlgebraic(input.from);
  const to = fromAlgebraic(input.to);

  if (from === null || to === null) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `Not a square: ${input.from}${input.to}`,
    );
  }

  if (needsPromotion(loaded, from, to) && input.promotion === undefined) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      "That move promotes a pawn. Say which piece to promote to.",
    );
  }

  const move = findLegalMove(loaded, from, to, input.promotion);
  if (!move) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `Illegal move: ${input.from}${input.to}`,
    );
  }

  let game = play(loaded, move);
  const yourMove = fromHistory(game.history[game.history.length - 1]!);

  let aiMove: MoveView | null = null;

  if (row.mode === "AI" && !isGameOver(game.status)) {
    const reply = findBestMove(
      game.position,
      botFor(row),
      game.history.map((entry) => entry.before),
    );

    if (reply) {
      game = play(game, reply);
      aiMove = fromHistory(game.history[game.history.length - 1]!);
    }
  }

  const nextTurnStartedAt = aiMove !== null ? new Date() : new Date(now);

  const result = await serializable(async (tx) => {
    const fresh = await tx.game.findUnique({ where: { id: row.id } });

    if (!fresh || fresh.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
    }

    const moved =
      input.ply !== fresh.moves.length ||
      fresh.moves.some((uci, index) => uci !== row.moves[index]);

    if (moved) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `The board has moved on: you played from ply ${input.ply}, the game is at ply ${fresh.moves.length}. Refetch the game.`,
      );
    }

    let settleClock: ClockState | undefined;
    let clockCommit:
      | { whiteTimeMs: number; blackTimeMs: number; turnStartedAt: Date }
      | undefined;

    const clock = clockState(fresh);
    if (
      clock !== null &&
      fresh.turnStartedAt !== null &&
      fresh.incrementSeconds !== null
    ) {
      const elapsed = Math.max(0, now - fresh.turnStartedAt.getTime());

      if (hasFlagged(clock, color, elapsed)) {
        const flagged: ClockState =
          color === "w"
            ? { whiteTimeMs: 0, blackTimeMs: clock.blackTimeMs }
            : { whiteTimeMs: clock.whiteTimeMs, blackTimeMs: 0 };
        const timeoutResult = resultForTimeout(color);

        const rewards =
          fresh.mode === "AI"
            ? await settle(tx, {
                row: fresh,
                game: loaded,
                user: input.user,
                color,
                result: timeoutResult,
                clock: flagged,
              })
            : await settlePvp(tx, {
                row: fresh,
                game: loaded,
                mover: input.user,
                result: timeoutResult,
                clock: flagged,
              });

        const settled = await tx.game.findUniqueOrThrow({
          where: { id: row.id },
        });
        return {
          yourMove,
          aiMove,
          state: view(settled, loaded, color, rewards, opponent),
        };
      }

      const advanced =
        clockAfterMove({
          clock,
          mover: color,
          elapsedMs: elapsed,
          incrementSeconds: fresh.incrementSeconds,
        }) ?? clock;

      settleClock = advanced;
      clockCommit = {
        whiteTimeMs: advanced.whiteTimeMs,
        blackTimeMs: advanced.blackTimeMs,
        turnStartedAt: nextTurnStartedAt,
      };
    }

    if (isGameOver(game.status)) {
      const result = resultFor(game.status, game.position.turn);

      const rewards =
        fresh.mode === "AI"
          ? await settle(tx, {
              row: fresh,
              game,
              user: input.user,
              color,
              result: result!,
              clock: settleClock,
            })
          : await settlePvp(tx, {
              row: fresh,
              game,
              mover: input.user,
              result: result!,
              clock: settleClock,
            });

      const settled = await tx.game.findUniqueOrThrow({
        where: { id: row.id },
      });
      return {
        yourMove,
        aiMove,
        state: view(settled, game, color, rewards, opponent),
      };
    }

    const declinesOffer =
      fresh.drawOfferedBy !== null &&
      toOfferColor(fresh.drawOfferedBy) !== color;

    const staleTakeback = fresh.takebackOfferedBy !== null;

    const updated = await tx.game.update({
      where: { id: row.id },
      data: {
        moves: gameMoves(game),
        currentFen: toFen(game.position),
        ...(declinesOffer ? { drawOfferedBy: null } : {}),
        ...(staleTakeback ? { takebackOfferedBy: null } : {}),
        ...(clockCommit ?? {}),
      },
    });

    return {
      yourMove,
      aiMove,
      state: view(updated, game, color, null, opponent),
    };
  });

  if (row.mode === "PVP") {
    if (result.state.endedAt === null) {
      markMoved(row.id, Date.now());
    } else {
      lastMoveAt.delete(row.id);
    }

    publishGameChanged(row.id);
  }

  if (result.state.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

export async function resignGame(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    const resigned = resultForResignation(color);
    const rewards =
      row.mode === "AI"
        ? await settle(tx, { row, game, user, color, result: resigned })
        : await settlePvp(tx, { row, game, mover: user, result: resigned });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  if (result.mode === "PVP") {
    publishGameChanged(gameId);
  }

  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

export async function abortGame(gameId: string, user: User): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    const playerHasMoved =
      row.mode === "AI" && color === "b"
        ? row.moves.length > 1
        : row.moves.length > 0;

    if (playerHasMoved) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "This game is under way. Resign it instead of aborting it.",
      );
    }

    const rewards =
      row.mode === "AI"
        ? await settle(tx, { row, game, user, color, result: "ABORTED" })
        : await settlePvp(tx, { row, game, mover: user, result: "ABORTED" });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  if (result.mode === "PVP") {
    publishGameChanged(gameId);
  }

  return result;
}
