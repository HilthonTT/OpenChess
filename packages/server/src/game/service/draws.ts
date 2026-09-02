import type { Prisma, Game as GameRow, User } from "@openchess/database";
import type { Color, Game } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { invalidateCache } from "../../lib/cache";
import { throwProblem } from "../../lib/problem-details";
import { publishGameChanged } from "../events";
import { toOfferSide, toOfferColor } from "../rules";
import { lastMoveAt } from "./activity";
import { loadFor } from "./loading";
import { settlePvp } from "./settlement";
import { serializable } from "./transactions";
import { type GameView, type OpponentView, view } from "./views";

/**
 * Draws by agreement.
 *
 * Only in a PvP game: agreeing a draw takes two players, and the bot is not a
 * negotiating party — asking it to accept would need a policy for when it says
 * yes, which is a strength setting masquerading as a rule. Against the bot the
 * position still draws itself by stalemate, repetition, the fifty-move rule or
 * insufficient material, all of which the engine already settles.
 *
 * One offer stands at a time, held in `Game.drawOfferedBy`. It is cleared by a
 * move from the side that did *not* offer — that move is the decline — and by
 * whatever ends the game. The offerer's own move leaves it standing, so the
 * ordinary habit of offering and then moving does not withdraw the offer a
 * moment later.
 */
const DRAW_IS_PVP_ONLY =
  "Only an online game can be drawn by agreement. The bot does not negotiate — play the position out, or resign.";

/** The half of a draw request every one of the three shares. */
async function loadForDraw(
  tx: Prisma.TransactionClient,
  gameId: string,
  user: User,
): Promise<{
  row: GameRow;
  game: Game;
  color: Color;
  opponent: OpponentView | null;
  /** The colour whose offer is standing, or null when none is. */
  offer: Color | null;
}> {
  const loaded = await loadFor(tx, gameId, user.id);

  return { ...loaded, offer: toOfferColor(loaded.row.drawOfferedBy) };
}

/** Settle a live PvP game as a draw both sides have now agreed to. */
async function agreeDraw(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    user: User;
    color: Color;
    opponent: OpponentView | null;
  },
): Promise<GameView> {
  const { row, game, color, opponent } = input;

  const rewards = await settlePvp(tx, {
    row,
    game,
    mover: input.user,
    result: "DRAW",
  });

  const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
  return view(settled, game, color, rewards, opponent);
}

/**
 * Offer a draw — or, when the opponent has already offered one, take it.
 *
 * That second case is not a shortcut so much as the only honest reading of two
 * players who both asked for a draw: it makes a simultaneous exchange of offers
 * settle instead of deadlocking on two clients each waiting for the other to
 * accept. Re-offering your own standing offer is a no-op, so a retried request
 * is safe.
 */
export async function offerDraw(gameId: string, user: User): Promise<GameView> {
  const { result, changed } = await serializable(async (tx) => {
    const { row, game, color, opponent, offer } = await loadForDraw(
      tx,
      gameId,
      user,
    );

    // Idempotent like resign: an already-settled game comes back as it stands.
    if (row.endedAt !== null) {
      return { result: view(row, game, color, null, opponent), changed: false };
    }

    if (row.mode !== "PVP") {
      throwProblem(HttpStatusCodes.CONFLICT, DRAW_IS_PVP_ONLY);
    }

    // They asked first; this is agreement, not a competing offer.
    if (offer !== null && offer !== color) {
      return {
        result: await agreeDraw(tx, { row, game, user, color, opponent }),
        changed: true,
      };
    }

    // Ours is already standing — nothing to do, and nothing to complain about.
    if (offer === color) {
      return { result: view(row, game, color, null, opponent), changed: false };
    }

    const updated = await tx.game.update({
      where: { id: row.id },
      data: { drawOfferedBy: toOfferSide(color) },
    });

    return {
      result: view(updated, game, color, null, opponent),
      changed: true,
    };
  });

  // The opponent is on a stream: an offer they are never told about is an offer
  // that does not exist. Their client learns of it the same way it learns of a
  // move, which is why this is published on a change that moves no piece.
  //
  // Only when something actually moved, unlike the settle paths: re-offering a
  // draw you have already offered is an ordinary keypress rather than a rare
  // retry, and waking every stream to say nothing has changed would make a held
  // key a broadcast. `changed` implies PvP — the other two exits cannot set it.
  if (changed) {
    publishGameChanged(gameId);
  }

  if (result.endedAt !== null) {
    lastMoveAt.delete(gameId);
  }

  // An agreed draw is a rated result on both sides, so the board is stale.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

export async function acceptDraw(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent, offer } = await loadForDraw(
      tx,
      gameId,
      user,
    );

    // A retried accept whose response was lost gets the settled game back,
    // rather than a complaint that the offer it accepted is gone.
    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    if (row.mode !== "PVP") {
      throwProblem(HttpStatusCodes.CONFLICT, DRAW_IS_PVP_ONLY);
    }

    if (offer === null) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "There is no draw offer to accept. Your opponent's last move declined it, if they had made one.",
      );
    }

    if (offer === color) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "That is your own draw offer — it is your opponent's to accept.",
      );
    }

    return agreeDraw(tx, { row, game, user, color, opponent });
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

/**
 * Clear the standing draw offer: the offerer withdrawing theirs, or the
 * opponent declining it. One route for both, because the game holds one offer
 * and either player is entitled to end it — which is also why this needs no
 * argument saying which of the two it was.
 *
 * Idempotent: no offer standing means there is nothing to clear, and the game
 * comes back as it is rather than as an error.
 */
export async function declineDraw(
  gameId: string,
  user: User,
): Promise<GameView> {
  const { result, cleared } = await serializable(async (tx) => {
    const { row, game, color, opponent, offer } = await loadForDraw(
      tx,
      gameId,
      user,
    );

    if (row.endedAt !== null || offer === null) {
      return {
        result: view(row, game, color, null, opponent),
        cleared: false,
      };
    }

    const updated = await tx.game.update({
      where: { id: row.id },
      data: { drawOfferedBy: null },
    });

    return {
      result: view(updated, game, color, null, opponent),
      cleared: true,
    };
  });

  // Only when something actually changed: an offer withdrawn is news to the
  // opponent's board, but a no-op decline would wake every stream for nothing.
  // An offer can only ever stand on a PvP game, so `cleared` implies the mode.
  if (cleared) {
    publishGameChanged(gameId);
  }

  return result;
}
