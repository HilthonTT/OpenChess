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

/**
 * Unfinished games are rows the resume flow will never reach past the newest
 * one; without a ceiling a client loop could grow the table without bound.
 */
const MAX_ACTIVE_GAMES = 20;

/**
 * The clock columns a new game is born with. An untimed game gets none of them,
 * leaving every clock field null — which is exactly what `view` reads as
 * "untimed", so the current behaviour is preserved by writing nothing.
 */
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
  /**
   * Which bot to play. The tier it plays at is read off the personality rather
   * than taken from the caller, so a client cannot ask for the Rookie and be
   * paid as though it had beaten the Maestro.
   */
  personality: PersonalityId;
  color: "white" | "black" | "random";
  timeControl?: TimeControlKey | null;
  variant?: GameVariant;
}): Promise<GameView> {
  // Checked outside a transaction, so two racing creates can land at cap + 1.
  // The ceiling is a backstop against runaway loops, not an invariant — off by
  // one is fine, and the next create is refused either way.
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

  // The array is drawn here, once, and written down. A shuffled game that only
  // stored its moves would replay onto the standard array and be a different
  // game every time it was read.
  const startFen = variant === "CHESS960" ? randomChess960Fen() : null;

  let game = createGame(startFen ?? undefined);

  // The bot has white, so it opens. Playing it here rather than on the first
  // move request means the client is never handed a board it is not to move on.
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
      // The clock starts after any opening the bot just played, so the human's
      // first think is measured from now rather than from before the bot moved.
      ...initialClockData(input.timeControl),
    },
  });

  return view(row, game, color, null);
}

export type QueueResult =
  | { status: "waiting"; game: null }
  | { status: "matched"; game: GameView };

/**
 * One poll of the matchmaking queue. The client calls this every couple of
 * seconds while searching; each call doubles as the heartbeat that keeps the
 * player eligible for pairing.
 *
 * An unfinished PvP game *is* the match — whether our last poll created it,
 * our partner's did, or it has been waiting since yesterday. One live PvP game
 * per player, resumed rather than multiplied.
 */
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

    // `colorOf` cannot miss: the query matched this user on one side or the
    // other. The fallback is for the type, not for a case that happens.
    const color = colorOf(existing, user.id) ?? "w";
    const opponent = await opponentFor(db, existing, user.id);

    return {
      status: "matched",
      game: view(existing, replay(existing), color, null, opponent),
    };
  }

  // Our partner's poll is creating the game row right now; our next poll will
  // find it above. Re-enqueueing here would risk a second pairing.
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

    // Deleted between queueing and pairing. Back to waiting.
    if (!partner) {
      await matchmaking.heartbeat(user.id, timeControl);
      return { status: "waiting", game: null };
    }

    const userIsWhite = Math.random() < 0.5;

    // The no-live-game check at the top of this poll is stale by now — a
    // delayed duplicate poll may have paired one of us meanwhile. Re-check and
    // create atomically, serializably, so two racing creates collide instead
    // of both landing; the loser reports "waiting" and its next poll resumes
    // whatever game exists.
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
              // Both sides queued for the same clock; this is that clock.
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
      // One of us already has a live game. Whoever it is resumes it on their
      // next poll; if it isn't us, the heartbeat puts us back in line.
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
    // Whatever the create's fate, release both players from the pairing
    // marker — on a failure they re-enqueue on their next poll.
    await matchmaking.completePairing(user.id, partnerId);
  }
}

/**
 * Stop searching. Idempotent, so a retry or a double-escape costs nothing.
 *
 * Returns false when a pairing for this player is already in flight: the queue
 * entry is gone either way, but a game is about to exist, and claiming "left"
 * would be a lie. The unwanted game can be aborted before its first move.
 */
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
  /** Null when your move ended the game. */
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
  // Stamped before any work: this is the moment the mover's move arrived, and
  // a timed game charges their clock for the gap since it last started. Taken
  // ahead of `findBestMove` so the human is never billed for the bot's CPU.
  const now = Date.now();

  // Everything up to and including the engine's reply runs before the
  // transaction opens: `findBestMove` is a synchronous minimax that can chew
  // real time, and running it inside a serializable transaction would spend
  // the transaction timeout on CPU and widen the conflict window for every
  // concurrent request. Nothing decided out here is trusted at commit time —
  // the guards are re-run on the live row inside the transaction.
  const {
    row,
    game: loaded,
    color,
    opponent,
  } = await loadFor(db, input.gameId, input.user.id);

  if (row.endedAt !== null) {
    throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
  }

  // The retry guard. Without it, a client that retries a request whose response
  // it never saw would play its move a second time.
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

  // Catch this before `findLegalMove`, which would otherwise quietly pick the
  // first matching promotion — always a queen — on the player's behalf.
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

  // In a PvP game there is no reply to make here: the opponent's move
  // arrives on their own request, and our client learns of it by polling.
  let aiMove: MoveView | null = null;

  if (row.mode === "AI" && !isGameOver(game.status)) {
    const reply = findBestMove(
      game.position,
      botFor(row),
      // The positions already played. Without them the bot cannot see a
      // repetition, and will shuffle a won game into a draw believing it is
      // still winning.
      game.history.map((entry) => entry.before),
    );

    if (reply) {
      game = play(game, reply);
      aiMove = fromHistory(game.history[game.history.length - 1]!);
    }
  }

  // The next turn starts when this request's last move was produced: at
  // arrival for a PvP move, but only after the search when the bot replied —
  // dating it from arrival would fold the bot's think time into the human's
  // next turn, and on a hard difficulty that bleeds their clock dry.
  const nextTurnStartedAt = aiMove !== null ? new Date() : new Date(now);

  const result = await serializable(async (tx) => {
    // The pre-transaction read is stale by definition. Re-run the
    // compare-and-set against the live row: a request that landed meanwhile
    // moved the ply (or ended the game), and this one must conflict rather
    // than overwrite it. Moves are append-only, so an equal length inside a
    // serializable transaction means the same prefix this move was computed on.
    const fresh = await tx.game.findUnique({ where: { id: row.id } });

    if (!fresh || fresh.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
    }

    if (input.ply !== fresh.moves.length) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `The board has moved on: you played from ply ${input.ply}, the game is at ply ${fresh.moves.length}. Refetch the game.`,
      );
    }

    // Clock bookkeeping, computed here so the settle and the plain update below
    // stay one path each whether the game is timed or not.
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

      // A move played on a fallen flag does not count: settle the position as
      // it stood *before* the move, a loss on time for the side that flagged.
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

      // The move stands: bank the mover's remaining time plus the increment,
      // and restart the clock for whoever is now to move. Not flagged, so
      // `clockAfterMove` never returns null here.
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

      // `isGameOver` is true and the status is terminal, so a result exists.
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

    // A move by the side that did *not* offer is the decline. The offerer's own
    // move leaves their offer standing — a player who offers and then moves, as
    // players do, has not changed their mind. (The terminal paths above go
    // through `claimGame`, which clears the offer along with everything else.)
    const declinesOffer =
      fresh.drawOfferedBy !== null &&
      toOfferColor(fresh.drawOfferedBy) !== color;

    // A takeback offer, unlike a draw offer, does not survive its own offerer's
    // move: it names the position to go back to, and playing on moves that
    // position. So this clears on any move rather than only the opponent's.
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

  // The abandonment clock measures from the last committed move; see
  // `lastMoveAt`. A settled game no longer needs one.
  if (row.mode === "PVP") {
    if (result.state.endedAt === null) {
      markMoved(row.id, Date.now());
    } else {
      lastMoveAt.delete(row.id);
    }

    // The opponent is watching this game on a stream. Only PvP: an AI game has
    // nobody on the other side to tell, and telling them anyway would spend a
    // Redis write per bot move.
    publishGameChanged(row.id);
  }

  // After the commit, never inside it: a bump inside the transaction could be
  // followed by another request re-filling the cache from a pre-commit read.
  // Null rewards means either the game is still going or a concurrent settle
  // won the race — and the winner does its own invalidating.
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

    // Resigning a game that is already over is a no-op, not an error: a client
    // retrying a resign it never saw the answer to deserves the same reply.
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

  // A resignation is a loss: rating and record moved, so the board is stale.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

// No leaderboard invalidation here: an abort settles the row but pays nothing
// and touches no stat the leaderboard shows.
export async function abortGame(gameId: string, user: User): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    // The escape hatch for a misclicked game. Keeping it distinct from a resign
    // is the whole point: an abort must never become a loss on the record.
    // In a PvP game the same rule doubles as the way out of a match whose
    // opponent never showed: no move played, no loss recorded, for either side.
    // What must not have happened is a move by *this* player: when the bot drew
    // white, its opening move is on the row from birth, and counting it would
    // make an AI game as black impossible to ever abort.
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
