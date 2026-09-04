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

const NOTHING_TO_TAKE_BACK = "There is no move of yours to take back yet.";

const GAME_IS_OVER =
  "This game is over. It has been rated and paid — there is nothing left to take back.";

function rewind(row: GameRow, plies: number): { moves: string[]; game: Game } {
  const moves = row.moves.slice(0, row.moves.length - plies);

  return {
    moves,
    game: fromRecord({ fen: row.startFen ?? undefined, moves }),
  };
}

function takebackClockData(
  row: GameRow,
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
    incrementFor: row.mode === "AI" ? running : undefined,
  });

  return {
    whiteTimeMs: rewound.whiteTimeMs,
    blackTimeMs: rewound.blackTimeMs,
    turnStartedAt: new Date(now),
  };
}

async function applyTakeback(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    color: Color;
    opponent: OpponentView | null;
    offerer: Color;
    charged: boolean;
  },
): Promise<GameView> {
  const { row, game, color, opponent, offerer } = input;

  const plies = pliesToTakeBack(game.history.length, offerer);

  if (plies === null) {
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
      drawOfferedBy: null,
      ...(input.charged ? { takebacks: { increment: 1 } } : {}),
      ...takebackClockData(row, game.position.turn, plies, Date.now()),
    },
  });

  return view(updated, rewound.game, color, null, opponent);
}

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

export async function offerTakeback(
  gameId: string,
  user: User,
): Promise<GameView> {
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

  if (changed) {
    publishGameChanged(gameId);
  }

  return result;
}

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

  publishGameChanged(gameId);

  return result;
}

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
