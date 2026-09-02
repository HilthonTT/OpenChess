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

/** How long a PvP opponent may sit on their turn before the win can be claimed. */
const CLAIM_VICTORY_AFTER_MS = 5 * 60_000;

/**
 * When each live PvP game last advanced, keyed by game id. The `Game` row
 * carries no updated-at column, so the abandonment clock runs here — in
 * memory, single-process by construction like the matchmaking queue. Entries
 * are written on every committed PvP move, dropped when a game settles, and
 * lost on a restart, which `lastActivityAt` answers by restarting the clock:
 * a restart can delay a claim, never award one against an opponent who moved
 * just before it.
 */
export const lastMoveAt = new Map<string, number>();

/**
 * An entry only matters for the 5-minute claim window that follows a move, so
 * one that has not advanced in far longer belongs to a game that was abandoned
 * without ever settling — an untimed PvP game both players walked away from
 * leaves its entry behind forever, since only a settlement drops it. Sweeping
 * such entries is safe under the same guarantee a restart gives: a game that
 * later resumes just has its clock re-based to `now` by `lastActivityAt`, which
 * can only delay a claim, never award one. Generous so a genuinely long think
 * on an untimed board is never evicted out from under an active game.
 */
const LAST_MOVE_STALE_MS = 60 * 60_000;

const SWEEP_INTERVAL_MS = 5 * 60_000;

let lastSweepAt = 0;

/** Record a PvP move's time, opportunistically evicting long-dead entries. */
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

/** The last time `row` demonstrably advanced. */
function lastActivityAt(row: GameRow): number {
  const tracked = lastMoveAt.get(row.id);
  if (tracked !== undefined) {
    return tracked;
  }

  // A board with no moves has not advanced since its creation, which the row
  // does record durably.
  if (row.moves.length === 0) {
    return row.startedAt.getTime();
  }

  const now = Date.now();
  lastMoveAt.set(row.id, now);
  return now;
}

/**
 * Claim the win in a PvP game whose opponent has walked away.
 *
 * The eligibility bar is deliberately high — the opponent must be on the move
 * and must have let the abandonment clock run out — because a claim settles a
 * rated loss on someone who never agreed to one. Settlement itself is exactly
 * a resignation by the absent side, so ratings, payouts and the ledger come
 * out identical to the opponent having resigned.
 */
export async function claimVictory(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    // Like a resign: claiming a game that is already over returns it as it
    // stands, so a client retrying a claim it never saw the answer to is safe.
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

  // Always PvP by the guard above: the absent opponent's stream, if they left
  // one open, learns the game is over rather than hanging on a dead position.
  publishGameChanged(gameId);

  // A claim is a rated win, so the board is stale — same as a resignation.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

/**
 * Settle a timed game whose running clock has fallen.
 *
 * Either player may call it; the server, not the caller, decides who flagged —
 * the side to move is the one whose clock is running, so it settles as a loss
 * for them whether that is the caller (their own flag fell while they sat on it)
 * or the opponent (whose walk-away the caller is cashing in). The move path
 * catches a flag the moment the flagged player tries to move; this catches the
 * one they never do.
 */
export async function flagGame(gameId: string, user: User): Promise<GameView> {
  const now = Date.now();

  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    // Idempotent like resign and claim: a game already settled comes back as it
    // stands, so a retry the client never saw the answer to is safe.
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

    // The running clock is the side to move's; that is who can flag right now.
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

  // A flag settles a decisive game: rating and record moved, so the board is
  // stale, exactly as a resignation or a claim leaves it.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}
