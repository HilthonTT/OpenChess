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

const DRAW_IS_PVP_ONLY =
  "Only an online game can be drawn by agreement. The bot does not negotiate — play the position out, or resign.";

async function loadForDraw(
  tx: Prisma.TransactionClient,
  gameId: string,
  user: User,
): Promise<{
  row: GameRow;
  game: Game;
  color: Color;
  opponent: OpponentView | null;
  offer: Color | null;
}> {
  const loaded = await loadFor(tx, gameId, user.id);

  return { ...loaded, offer: toOfferColor(loaded.row.drawOfferedBy) };
}

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

export async function offerDraw(gameId: string, user: User): Promise<GameView> {
  const { result, changed } = await serializable(async (tx) => {
    const { row, game, color, opponent, offer } = await loadForDraw(
      tx,
      gameId,
      user,
    );

    if (row.endedAt !== null) {
      return { result: view(row, game, color, null, opponent), changed: false };
    }

    if (row.mode !== "PVP") {
      throwProblem(HttpStatusCodes.CONFLICT, DRAW_IS_PVP_ONLY);
    }

    if (offer !== null && offer !== color) {
      return {
        result: await agreeDraw(tx, { row, game, user, color, opponent }),
        changed: true,
      };
    }

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

  if (changed) {
    publishGameChanged(gameId);
  }

  if (result.endedAt !== null) {
    lastMoveAt.delete(gameId);
  }

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

  if (cleared) {
    publishGameChanged(gameId);
  }

  return result;
}
