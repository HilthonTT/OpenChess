import type { ChatScope, User } from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  isPlayerPhraseId,
  isSpectatorPhraseId,
  type ChatPhraseId,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { publishGameChanged } from "./events";

const MAX_MESSAGES_PER_SENDER = 20;

const CHAT_WINDOW = 12;

export type ChatMessageView = {
  id: string;
  phrase: ChatPhraseId;
  mine: boolean;
  username: string;
  createdAt: string;
};

const WITH_SENDER = {
  sender: { select: { id: true, username: true } },
} as const;

function view(
  row: {
    id: string;
    phrase: string;
    senderId: string;
    createdAt: Date;
    sender: { username: string };
  },
  userId: string,
): ChatMessageView {
  return {
    id: row.id,
    phrase: row.phrase as ChatPhraseId,
    mine: row.senderId === userId,
    username: row.sender.username,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listChat(
  gameId: string,
  userId: string,
  scope: ChatScope,
): Promise<ChatMessageView[]> {
  const rows = await db.gameMessage.findMany({
    where: { gameId, scope },
    orderBy: { createdAt: "desc" },
    take: CHAT_WINDOW,
    select: {
      id: true,
      phrase: true,
      senderId: true,
      createdAt: true,
      ...WITH_SENDER,
    },
  });

  return rows.reverse().map((row) => view(row, userId));
}

export async function attachChat<T extends { id: string; mode: "AI" | "PVP" }>(
  game: T,
  user: User,
): Promise<T & { chat: ChatMessageView[] }> {
  return {
    ...game,
    chat:
      game.mode === "PVP" ? await listChat(game.id, user.id, "PLAYERS") : [],
  };
}

export async function attachSpectatorChat<T extends { id: string }>(
  game: T,
  user: User,
): Promise<T & { chat: ChatMessageView[] }> {
  return { ...game, chat: await listChat(game.id, user.id, "SPECTATORS") };
}

function seatFor(
  game: { whitePlayerId: string | null; blackPlayerId: string | null },
  userId: string,
): ChatScope {
  return game.whitePlayerId === userId || game.blackPlayerId === userId
    ? "PLAYERS"
    : "SPECTATORS";
}

export async function sendChatMessage(input: {
  gameId: string;
  user: User;
  phrase: string;
  scope: ChatScope;
}): Promise<ChatMessageView[]> {
  const game = await db.game.findUnique({
    where: { id: input.gameId },
    select: { id: true, mode: true, whitePlayerId: true, blackPlayerId: true },
  });

  if (!game) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  if (game.mode !== "PVP") {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      input.scope === "PLAYERS"
        ? "There is nobody to say that to — the bot does not read."
        : "An AI game has no gallery. It is a private board, and only the player at it can see it.",
    );
  }

  const seat = seatFor(game, input.user.id);

  if (seat !== input.scope) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      seat === "PLAYERS"
        ? "You are playing this game — say it to your opponent, not to the gallery."
        : "You are not a player in this game. The watchers have their own channel.",
    );
  }

  const admits =
    input.scope === "PLAYERS" ? isPlayerPhraseId : isSpectatorPhraseId;

  if (!admits(input.phrase)) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `"${input.phrase}" is not something you can say here`,
    );
  }

  const sent = await db.gameMessage.count({
    where: { gameId: game.id, senderId: input.user.id, scope: input.scope },
  });

  if (sent >= MAX_MESSAGES_PER_SENDER) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have said your ${MAX_MESSAGES_PER_SENDER} for this game.`,
    );
  }

  await db.gameMessage.create({
    data: {
      gameId: game.id,
      senderId: input.user.id,
      scope: input.scope,
      phrase: input.phrase,
    },
  });

  publishGameChanged(game.id);

  return listChat(game.id, input.user.id, input.scope);
}
