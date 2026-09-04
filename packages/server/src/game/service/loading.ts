import type { Prisma, Game as GameRow } from "@openchess/database";
import type { Color, Game } from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../../lib/problem-details";
import { type OpponentView, colorOf, replay } from "./views";

export async function opponentFor(
  tx: Prisma.TransactionClient,
  row: GameRow,
  userId: string,
): Promise<OpponentView | null> {
  const opponentId =
    row.whitePlayerId === userId ? row.blackPlayerId : row.whitePlayerId;

  if (!opponentId) {
    return null;
  }

  const opponent = await tx.user.findUnique({
    where: { id: opponentId },
    select: { username: true, equippedTitle: { select: { label: true } } },
  });

  return opponent
    ? {
        username: opponent.username,
        title: opponent.equippedTitle?.label ?? null,
      }
    : null;
}

export async function loadFor(
  tx: Prisma.TransactionClient,
  gameId: string,
  userId: string,
): Promise<{
  row: GameRow;
  game: Game;
  color: Color;
  opponent: OpponentView | null;
}> {
  const row = await tx.game.findUnique({ where: { id: gameId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  const color = colorOf(row, userId);
  if (!color) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      "You are not a player in this game",
    );
  }

  const opponent =
    row.mode === "PVP" ? await opponentFor(tx, row, userId) : null;

  return { row, game: replay(row), color, opponent };
}
