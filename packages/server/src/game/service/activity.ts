import type { Game as GameRow, User } from "@openchess/database";
import type { Color } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { invalidateCache } from "../../lib/cache";
import { throwProblem } from "../../lib/problem-details";
import { publishGameChanged } from "../events";
import {
  hasFlagged,
  resultForResignation,
  resultForTimeout,
  timeOf,
  type ClockState,
} from "../rules";
import { loadFor } from "./loading";
import { settle, settlePvp } from "./settlement";
import { serializable } from "./transactions";
import { type GameView, clockState, view } from "./views";

const CLAIM_VICTORY_AFTER_MS = 5 * 60_000;

export const lastMoveAt = new Map<string, number>();

const LAST_MOVE_STALE_MS = 60 * 60_000;

const SWEEP_INTERVAL_MS = 5 * 60_000;

let lastSweepAt = 0;

export function markMoved(gameId: string, at: number): void {
  lastMoveAt.set(gameId, at);

  if (at - lastSweepAt < SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepAt = at;
  for (const [id, when] of lastMoveAt) {
    if (at - when > LAST_MOVE_STALE_MS) {
      lastMoveAt.delete(id);
    }
  }
}

function lastActivityAt(row: GameRow): number {
  const tracked = lastMoveAt.get(row.id);
  if (tracked !== undefined) {
    return tracked;
  }

  if (row.moves.length === 0) {
    return row.startedAt.getTime();
  }

  const now = Date.now();
  lastMoveAt.set(row.id, now);
  return now;
}

export async function claimVictory(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    if (row.mode !== "PVP") {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Only an online game can be claimed. The bot never abandons; resign instead.",
      );
    }

    if (game.position.turn === color) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "It is your turn: play a move, or resign.",
      );
    }

    const idleMs = Date.now() - lastActivityAt(row);
    if (idleMs < CLAIM_VICTORY_AFTER_MS) {
      const wait = Math.ceil((CLAIM_VICTORY_AFTER_MS - idleMs) / 1000);
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `Your opponent still has ${wait}s to move before the win can be claimed.`,
      );
    }

    const absent: Color = color === "w" ? "b" : "w";
    const rewards = await settlePvp(tx, {
      row,
      game,
      mover: user,
      result: resultForResignation(absent),
    });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  publishGameChanged(gameId);

  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

export async function flagGame(gameId: string, user: User): Promise<GameView> {
  const now = Date.now();

  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    const clock = clockState(row);
    if (clock === null || row.turnStartedAt === null) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "This game has no clock to run out.",
      );
    }

    const ticking = game.position.turn;
    const elapsed = Math.max(0, now - row.turnStartedAt.getTime());

    if (!hasFlagged(clock, ticking, elapsed)) {
      const left = Math.ceil((timeOf(clock, ticking) - elapsed) / 1000);
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `There is still ${left}s on the clock. Nobody has flagged yet.`,
      );
    }

    const flagged: ClockState =
      ticking === "w"
        ? { whiteTimeMs: 0, blackTimeMs: clock.blackTimeMs }
        : { whiteTimeMs: clock.whiteTimeMs, blackTimeMs: 0 };
    const timeoutResult = resultForTimeout(ticking);

    const rewards =
      row.mode === "AI"
        ? await settle(tx, {
            row,
            game,
            user,
            color,
            result: timeoutResult,
            clock: flagged,
          })
        : await settlePvp(tx, {
            row,
            game,
            mover: user,
            result: timeoutResult,
            clock: flagged,
          });

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
