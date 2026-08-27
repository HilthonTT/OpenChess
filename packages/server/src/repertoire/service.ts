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

/**
 * The opening repertoire: the lines you have decided are yours, and a schedule
 * for proving you still know them.
 *
 * Three decisions shape everything here.
 *
 * **The line is validated, not trusted.** A row is written only after its SAN
 * replays through the engine from the initial array. The alternative — storing
 * whatever the client sent and finding out at drill time — turns an authoring
 * slip into a line that cannot be played and cannot be reviewed, sitting in the
 * queue forever because failing it is the only thing you can do with it.
 *
 * **The schedule is the server's.** `dueAt` is written here, from a clock the
 * player does not own, for the same reason the daily streak's day boundary is:
 * a review that pays XP is exactly the thing somebody would move their clock
 * for.
 *
 * **Only a due review pays.** Drilling a line early is free, unlimited, and
 * worth nothing — which is the right price for practice you asked for. A clean
 * review pushes the next one at least a day out, so a line can pay at most once
 * a day, and `MAX_REPERTOIRE_LINES` bounds how many lines there are to pay. No
 * further anti-farm rule is needed, because those two together already are one.
 */

const UNIQUE_VIOLATION = "P2002";

export type RepertoireLineView = {
  id: string;
  eco: string;
  name: string;
  /** The line in SAN, from the initial array. */
  moves: string[];
  side: "w" | "b";
  /** How many of the moves are the player's — what a drill actually asks for. */
  yourMoves: number;
  ease: number;
  intervalDays: number;
  reviews: number;
  lapses: number;
  streak: number;
  dueAt: string;
  lastReviewedAt: string | null;
  /** Whether it is due now. Computed here so a client cannot disagree. */
  due: boolean;
  createdAt: string;
};

export type ReviewResult = {
  line: RepertoireLineView;
  /** What the drill was graded, so a screen can say why the interval moved. */
  grade: "again" | "good" | "easy";
  /** XP earned, and null when the line was not due — see the module note. */
  reward: {
    xp: number;
    levelBefore: number;
    levelAfter: number;
  } | null;
};

const TO_COLOR: Record<RepertoireSide, "w" | "b"> = { WHITE: "w", BLACK: "b" };
const TO_SIDE: Record<"w" | "b", RepertoireSide> = { w: "WHITE", b: "BLACK" };

/**
 * How many of a line's moves belong to `side`.
 *
 * White plays the even plies, so a line of `n` moves has `ceil(n / 2)` of
 * white's and `floor(n / 2)` of black's. This is what a drill asks the player
 * to find, and what a review is paid on — a black repertoire line of five moves
 * is two moves of work, not five.
 */
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

/** The line's identity: the colour it is trained from, and the moves. */
function keyFor(side: RepertoireSide, moves: string[]): string {
  return `${side}:${moves.join(" ")}`;
}

/**
 * Replay the line, and hand back the SAN the engine actually produced.
 *
 * Normalising through the engine rather than storing the client's strings is
 * what makes `lineKey` an identity: `Nf3`, `Nf3+` and `Ng1f3` are one move, and
 * three spellings of it would otherwise be three rows drilled three times. It
 * is also the validation — a line that does not play out throws here, before a
 * row exists.
 */
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

/** Every line this player keeps, soonest due first. */
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

/**
 * The line to drill next, or null when nothing is due.
 *
 * Soonest due first, which for a queue with anything overdue in it means the
 * thing you have been putting off longest. Null rather than "here is one that
 * is not due yet": the point of a schedule is that it says when to stop, and a
 * trainer that always has one more line is one that never tells you you are
 * finished. Drilling ahead is still possible — it is just something you ask
 * for, by picking a line off the list.
 */
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
    // The same answer for "no such line" and "somebody else's line": a
    // repertoire is private, and telling a stranger that an id exists is
    // telling them something about a player who did not ask to be asked about.
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such line");
  }

  return view(row, new Date());
}

/** Add a line. Adding one you already keep returns it rather than failing. */
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
    // A one-move line from black's side asks the player to find nothing.
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      "That line holds no move of yours to remember. Add a move, or train it from the other side.",
    );
  }

  const lineKey = keyFor(side, moves);

  // Checked before the insert rather than after the unique violation, because
  // the two failures mean different things: at the cap a player is told to
  // remove something, and on a duplicate they are told nothing at all because
  // there is nothing wrong. A race between two adds at exactly the cap can
  // leave one line over it, which is a better outcome than a transaction taken
  // out to prevent a player from having 121 lines.
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
      // Already kept. Not an error: adding a line you already have is a player
      // saying "this one is mine", which it is, and answering with a complaint
      // would make the explorer's key feel broken on the second press.
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

/** Drop a line. Dropping one that is already gone is not an error. */
export async function removeRepertoireLine(
  user: User,
  id: string,
): Promise<void> {
  // `deleteMany` rather than `delete`, so the ownership check and the delete
  // are one statement: a line belonging to somebody else matches nothing and
  // is reported as missing, which is also what it is from here.
  const { count } = await db.repertoireLine.deleteMany({
    where: { id, userId: user.id },
  });

  if (count === 0) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such line");
  }
}

/**
 * Record a drill and reschedule the line.
 *
 * The client reports what happened — how many moves it got wrong, and how long
 * it took — and the grading lives in @openchess/shared so the screen can say
 * what a review will be worth before it sends it. What the client cannot do is
 * decide the interval, the due date or the payout, all of which are computed
 * here from the row as it stands.
 *
 * `mistakes` is the one number worth being suspicious of, and it is not worth
 * being very suspicious of: understating it is claiming a clean run of a line
 * nobody else is scored against, for XP capped at thirty a day per line. The
 * honest reading is that the player is drilling their own repertoire and the
 * only person a lie costs is them.
 */
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

  // Read before the write, so an early drill is told apart from a due one by
  // the state the request arrived in rather than the one it leaves behind.
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
      // An early drill still reschedules. It is a review — the player has just
      // proved they know the line — and leaving the old date would mean the
      // queue asking for it again this afternoon.
      dueAt: nextDue(after, now),
    },
  });

  if (xp === 0) {
    return { line: view(updated, now), grade, reward: null };
  }

  // Re-read the player inside the payout, as every payout path here does: the
  // request-scoped user predates it, and a concurrent game or puzzle settle may
  // have moved XP since. No coins, so no ledger row — the ledger records money,
  // and this pays none.
  const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  const experience = fresh.experience + xp;
  const levelAfter = levelFor(experience);

  await db.user.update({
    where: { id: user.id },
    data: { experience, level: levelAfter },
  });

  return {
    line: view(updated, now),
    grade,
    reward: { xp, levelBefore: fresh.level, levelAfter },
  };
}
