import {
  Prisma,
  type RepertoireLine as LineRow,
  type RepertoireSide,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  createGame,
  gradeFor,
  MAX_REPERTOIRE_LINES,
  MAX_REPERTOIRE_PLIES,
  nextDue,
  playSan,
  reviewLine,
  reviewXp,
  type ReviewState,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { levelFor } from "../game/rules";
import { throwProblem } from "../lib/problem-details";

const UNIQUE_VIOLATION = "P2002";
const SERIALIZATION_FAILURE = "P2034";

export type RepertoireLineView = {
  id: string;
  eco: string;
  name: string;
  moves: string[];
  side: "w" | "b";
  yourMoves: number;
  ease: number;
  intervalDays: number;
  reviews: number;
  lapses: number;
  streak: number;
  dueAt: string;
  lastReviewedAt: string | null;
  due: boolean;
  createdAt: string;
};

export type ReviewResult = {
  line: RepertoireLineView;
  grade: "again" | "good" | "easy";
  reward: {
    xp: number;
    levelBefore: number;
    levelAfter: number;
  } | null;
};

const TO_COLOR: Record<RepertoireSide, "w" | "b"> = { WHITE: "w", BLACK: "b" };
const TO_SIDE: Record<"w" | "b", RepertoireSide> = { w: "WHITE", b: "BLACK" };

export function yourMoveCount(moves: number, side: "w" | "b"): number {
  return side === "w" ? Math.ceil(moves / 2) : Math.floor(moves / 2);
}

function stateOf(row: LineRow): ReviewState {
  return {
    ease: row.ease,
    intervalDays: row.intervalDays,
    reviews: row.reviews,
    lapses: row.lapses,
    streak: row.streak,
  };
}

function view(row: LineRow, now: Date): RepertoireLineView {
  const side = TO_COLOR[row.side];

  return {
    id: row.id,
    eco: row.eco,
    name: row.name,
    moves: row.moves,
    side,
    yourMoves: yourMoveCount(row.moves.length, side),
    ease: row.ease,
    intervalDays: row.intervalDays,
    reviews: row.reviews,
    lapses: row.lapses,
    streak: row.streak,
    dueAt: row.dueAt.toISOString(),
    lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
    due: row.dueAt.getTime() <= now.getTime(),
    createdAt: row.createdAt.toISOString(),
  };
}

function keyFor(side: RepertoireSide, moves: string[]): string {
  return `${side}:${moves.join(" ")}`;
}

function normalize(moves: string[]): string[] {
  let game = createGame();
  const played: string[] = [];

  for (const san of moves) {
    try {
      game = playSan(game, san);
    } catch {
      throwProblem(
        HttpStatusCodes.UNPROCESSABLE_ENTITY,
        `That line does not play out: ${san} is not legal at move ${
          Math.floor(played.length / 2) + 1
        }.`,
      );
    }

    const entry = game.history[game.history.length - 1];

    if (!entry) {
      throwProblem(
        HttpStatusCodes.UNPROCESSABLE_ENTITY,
        "That line does not play out.",
      );
    }

    played.push(entry.san);
  }

  return played;
}

export async function listRepertoire(
  user: User,
): Promise<RepertoireLineView[]> {
  const now = new Date();

  const rows = await db.repertoireLine.findMany({
    where: { userId: user.id },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
  });

  return rows.map((row) => view(row, now));
}

export async function nextDueLine(
  user: User,
): Promise<RepertoireLineView | null> {
  const now = new Date();

  const row = await db.repertoireLine.findFirst({
    where: { userId: user.id, dueAt: { lte: now } },
    orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
  });

  return row ? view(row, now) : null;
}

export async function getRepertoireLine(
  user: User,
  id: string,
): Promise<RepertoireLineView> {
  const row = await db.repertoireLine.findUnique({ where: { id } });

  if (!row || row.userId !== user.id) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such line");
  }

  return view(row, new Date());
}

export async function addRepertoireLine(
  user: User,
  input: { eco: string; name: string; moves: string[]; side: "w" | "b" },
): Promise<{ line: RepertoireLineView; added: boolean }> {
  if (input.moves.length === 0) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      "A line needs at least one move.",
    );
  }

  if (input.moves.length > MAX_REPERTOIRE_PLIES) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `That line is ${input.moves.length} moves long; ${MAX_REPERTOIRE_PLIES} is the most a drill will take.`,
    );
  }

  const side = TO_SIDE[input.side];
  const moves = normalize(input.moves);

  if (yourMoveCount(moves.length, input.side) === 0) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      "That line holds no move of yours to remember. Add a move, or train it from the other side.",
    );
  }

  const lineKey = keyFor(side, moves);

  const kept = await db.repertoireLine.count({ where: { userId: user.id } });

  if (kept >= MAX_REPERTOIRE_LINES) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `Your repertoire is full at ${MAX_REPERTOIRE_LINES} lines. Remove one you no longer play.`,
    );
  }

  try {
    const row = await db.repertoireLine.create({
      data: {
        userId: user.id,
        eco: input.eco,
        name: input.name,
        moves,
        side,
        lineKey,
      },
    });

    return { line: view(row, new Date()), added: true };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === UNIQUE_VIOLATION
    ) {
      const existing = await db.repertoireLine.findUnique({
        where: { userId_lineKey: { userId: user.id, lineKey } },
      });

      if (existing) {
        return { line: view(existing, new Date()), added: false };
      }
    }

    throw error;
  }
}

export async function removeRepertoireLine(
  user: User,
  id: string,
): Promise<void> {
  const { count } = await db.repertoireLine.deleteMany({
    where: { id, userId: user.id },
  });

  if (count === 0) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such line");
  }
}

export async function reviewRepertoireLine(
  user: User,
  id: string,
  input: { mistakes: number; msSpent: number | null },
): Promise<ReviewResult> {
  const row = await db.repertoireLine.findUnique({ where: { id } });

  if (!row || row.userId !== user.id) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such line");
  }

  const now = new Date();
  const side = TO_COLOR[row.side];
  const moves = yourMoveCount(row.moves.length, side);

  const grade = gradeFor({
    mistakes: input.mistakes,
    msSpent: input.msSpent,
    moves,
  });

  const after = reviewLine(stateOf(row), grade);

  const wasDue = row.dueAt.getTime() <= now.getTime();
  const xp = wasDue ? reviewXp({ grade, moves }) : 0;

  const updated = await db.repertoireLine.update({
    where: { id: row.id },
    data: {
      ease: after.ease,
      intervalDays: after.intervalDays,
      reviews: after.reviews,
      lapses: after.lapses,
      streak: after.streak,
      lastReviewedAt: now,
      dueAt: nextDue(after, now),
    },
  });

  if (xp === 0) {
    return { line: view(updated, now), grade, reward: null };
  }

  const reward = await payoutXp(user.id, xp);

  return { line: view(updated, now), grade, reward };
}

async function payoutXp(
  userId: string,
  xp: number,
): Promise<{ xp: number; levelBefore: number; levelAfter: number }> {
  try {
    return await db.$transaction(
      async (tx) => {
        const fresh = await tx.user.findUniqueOrThrow({
          where: { id: userId },
        });
        const experience = fresh.experience + xp;
        const levelAfter = levelFor(experience);

        await tx.user.update({
          where: { id: userId },
          data: { experience, level: levelAfter },
        });

        return { xp, levelBefore: fresh.level, levelAfter };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === SERIALIZATION_FAILURE
    ) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request touched your account at the same time. Try the drill again.",
      );
    }

    throw error;
  }
}
