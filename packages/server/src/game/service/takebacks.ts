import type { Prisma, Game as GameRow, User } from "@openchess/database";
import { db } from "@openchess/database/client";
import { fromRecord, toFen, type Color, type Game } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../../lib/problem-details";
import { publishGameChanged } from "../events";
import {
  clockAfterTakeback,
  pliesToTakeBack,
  toOfferSide,
  toOfferColor,
} from "../rules";
import { loadFor } from "./loading";
import { serializable } from "./transactions";
import { type GameView, type OpponentView, clockState, view } from "./views";

/**
 * Takebacks.
 *
 * Two features wearing one name, because from the board's side they are the
 * same edit — drop the last ply or two and replay — and only the permission to
 * make it differs:
 *
 * - **Against a bot, you simply take it.** There is nobody to ask. What stops
 *   that being a cheat code is the price: the first takeback voids the game's
 *   payout, the same way a puzzle hint halves its own. Rewind as often as you
 *   like, learn what you came to learn, and the game pays nothing.
 * - **Against a person, you ask.** The offer machinery is the draw's, for the
 *   same reason it exists there: one offer stands at a time, and the opponent's
 *   answer is the whole of the rule. No payout guard is needed, because the
 *   guard is the opponent — nobody hands back the move that was winning.
 *
 * The one thing neither can do is rewind past the start of the game or into a
 * settled one. A finished game has been paid and rated; a takeback there would
 * be an unwind of the ledger, which is a refund and not a chess move.
 */

/** A takeback needs a live game with a move of your own in it. */
const NOTHING_TO_TAKE_BACK = "There is no move of yours to take back yet.";

const GAME_IS_OVER =
  "This game is over. It has been rated and paid — there is nothing left to take back.";

/**
 * The board after `plies` are dropped off the end, and the move list that
 * produced it.
 *
 * Replayed from the truncated list rather than un-applied from the current
 * position, because a move is not reversibly encoded: undoing a capture needs
 * the captured piece, undoing a castle needs the rook's old square, and undoing
 * an en passant needs both. The stored list is the record; replaying a prefix of
 * it is the only rewind that cannot be subtly wrong.
 */
function rewind(row: GameRow, plies: number): { moves: string[]; game: Game } {
  const moves = row.moves.slice(0, row.moves.length - plies);

  return {
    moves,
    game: fromRecord({ fen: row.startFen ?? undefined, moves }),
  };
}

/** The clock columns a takeback commits; empty when the game is untimed. */
function takebackClockData(
  row: GameRow,
  /** Whose clock is running as the takeback lands. */
  running: Color,
  plies: number,
  now: number,
): Partial<
  Pick<GameRow, "whiteTimeMs" | "blackTimeMs"> & { turnStartedAt: Date }
> {
  const clock = clockState(row);

  if (
    clock === null ||
    row.turnStartedAt === null ||
    row.incrementSeconds === null
  ) {
    return {};
  }

  const rewound = clockAfterTakeback({
    clock,
    running,
    elapsedMs: Math.max(0, now - row.turnStartedAt.getTime()),
    plies,
    incrementSeconds: row.incrementSeconds,
  });

  return {
    whiteTimeMs: rewound.whiteTimeMs,
    blackTimeMs: rewound.blackTimeMs,
    // The clock restarts here, not at the move being undone: the side now to
    // move has a fresh decision in front of them, and billing them for the time
    // their opponent spent deciding to ask would be a strange charge.
    turnStartedAt: new Date(now),
  };
}

/** Rewind the board to `offerer`'s turn — agreed, or taken from the bot. */
async function applyTakeback(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    /** The caller's colour, for the view that comes back. */
    color: Color;
    opponent: OpponentView | null;
    /** Whose move is being handed back. */
    offerer: Color;
    /** Whether this one costs the game its payout. AI games only. */
    charged: boolean;
  },
): Promise<GameView> {
  const { row, game, color, opponent, offerer } = input;

  const plies = pliesToTakeBack(game.history.length, offerer);

  if (plies === null) {
    // The board moved under the offer: it is the offer that is stale rather
    // than the request that is wrong, so this reads as a conflict and a refetch
    // is the cure — the same answer a move played from the wrong ply gets.
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "The board has moved on — that takeback no longer names a position anyone is in.",
    );
  }

  const rewound = rewind(row, plies);

  const updated = await tx.game.update({
    where: { id: row.id },
    data: {
      moves: rewound.moves,
      currentFen: toFen(rewound.game.position),
      takebackOfferedBy: null,
      // A draw offer standing over a position that is being rewound is an offer
      // about a game that no longer exists. It goes with it.
      drawOfferedBy: null,
      ...(input.charged ? { takebacks: { increment: 1 } } : {}),
      ...takebackClockData(row, game.position.turn, plies, Date.now()),
    },
  });

  return view(updated, rewound.game, color, null, opponent);
}

/**
 * Take back your last move against the bot, at the cost of the game's payout.
 *
 * Not an offer and not a negotiation — the board simply moves. Idempotence is
 * neither available nor wanted here: two presses are two takebacks, which is
 * exactly what a player holding the key means by them.
 */
async function takeBackFromBot(gameId: string, user: User): Promise<GameView> {
  return serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, GAME_IS_OVER);
    }

    if (pliesToTakeBack(game.history.length, color) === null) {
      throwProblem(HttpStatusCodes.CONFLICT, NOTHING_TO_TAKE_BACK);
    }

    return applyTakeback(tx, {
      row,
      game,
      color,
      opponent,
      offerer: color,
      charged: true,
    });
  });
}

/**
 * Ask for your move back — or, when the opponent has already asked, agree.
 *
 * The second reading is the draw's, and for the same reason: two clients each
 * waiting for the other to accept is a deadlock, and two players who both want
 * a takeback want the same one. Whose move comes back is the *offerer's*, so
 * agreeing to theirs hands them their move rather than you yours.
 *
 * Against a bot this is not an offer at all and routes to `takeBackFromBot`
 * rather than refusing: "take that back" means one thing to the player pressing
 * it, and a client should not have to know which of two shapes it is asking for.
 */
export async function offerTakeback(
  gameId: string,
  user: User,
): Promise<GameView> {
  // Read outside the transaction only to pick the shape. Both branches re-read
  // the row inside their own, so a mode that somehow changed under this — it
  // cannot; a game is born with its mode — would still be handled correctly.
  const found = await db.game.findUnique({
    where: { id: gameId },
    select: { mode: true },
  });

  if (found?.mode === "AI") {
    return takeBackFromBot(gameId, user);
  }

  const { result, changed } = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);
    const offer = toOfferColor(row.takebackOfferedBy);

    if (row.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, GAME_IS_OVER);
    }

    // They asked first: this is agreement, and it is *their* move that returns.
    if (offer !== null && offer !== color) {
      return {
        result: await applyTakeback(tx, {
          row,
          game,
          color,
          opponent,
          offerer: offer,
          charged: false,
        }),
        changed: true,
      };
    }

    if (pliesToTakeBack(game.history.length, color) === null) {
      throwProblem(HttpStatusCodes.CONFLICT, NOTHING_TO_TAKE_BACK);
    }

    // Ours already stands. A held key is not news, and waking the opponent's
    // stream to tell them nothing has changed would make it one.
    if (offer === color) {
      return { result: view(row, game, color, null, opponent), changed: false };
    }

    const updated = await tx.game.update({
      where: { id: row.id },
      data: { takebackOfferedBy: toOfferSide(color) },
    });

    return {
      result: view(updated, game, color, null, opponent),
      changed: true,
    };
  });

  // The opponent is on a stream: a request they are never told about is a
  // request that does not exist. Same reasoning as the draw offer's publish,
  // including the `changed` guard.
  if (changed) {
    publishGameChanged(gameId);
  }

  return result;
}

/** Grant the takeback the opponent asked for. */
export async function acceptTakeback(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);
    const offer = toOfferColor(row.takebackOfferedBy);

    if (row.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, GAME_IS_OVER);
    }

    if (offer === null) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "There is no takeback to grant. Any move clears one, and one has been played since.",
      );
    }

    if (offer === color) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "That is your own request — it is your opponent's to grant.",
      );
    }

    return applyTakeback(tx, {
      row,
      game,
      color,
      opponent,
      offerer: offer,
      charged: false,
    });
  });

  // Unconditional, unlike the offer: the board moved, and the opponent is
  // holding a position that no longer exists. Only a PvP game reaches here —
  // an AI one was routed away before any offer could be standing on it.
  publishGameChanged(gameId);

  return result;
}

/**
 * Clear the standing takeback request: the asker withdrawing, or the opponent
 * refusing. One route for both, exactly as the draw's decline is, and for the
 * same reason — the game holds one request and either player may end it, which
 * is also why this needs no argument saying which of the two it was.
 *
 * Idempotent: with nothing standing there is nothing to clear, and the game
 * comes back as it is rather than as an error.
 */
export async function declineTakeback(
  gameId: string,
  user: User,
): Promise<GameView> {
  const { result, cleared } = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null || row.takebackOfferedBy === null) {
      return { result: view(row, game, color, null, opponent), cleared: false };
    }

    const updated = await tx.game.update({
      where: { id: row.id },
      data: { takebackOfferedBy: null },
    });

    return {
      result: view(updated, game, color, null, opponent),
      cleared: true,
    };
  });

  if (cleared) {
    publishGameChanged(gameId);
  }

  return result;
}
