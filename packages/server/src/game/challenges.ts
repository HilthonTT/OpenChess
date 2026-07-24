import {
  Prisma,
  type Challenge as ChallengeRow,
  type ChallengeColor,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  createGame,
  timeControlFor,
  toFen,
  type TimeControlKey,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { publishGameChanged } from "./events";
import * as matchmaking from "./matchmaking";
import { toClockPreset, toTimeControlKey } from "./rules";
import { getGame, initialClockData, type GameView } from "./service";

/**
 * Direct challenges: playing someone you picked, rather than whoever the queue
 * hands you.
 *
 * Two shapes, one row. A challenge addressed to a player shows up in their
 * inbox; an open one is addressed to nobody and travels as a `code` — the thing
 * you read out to a friend, or paste into a chat. Accepting either one creates
 * exactly the same PvP game the queue would have, so everything downstream —
 * the clock, the stream, rating, payouts — is unchanged.
 *
 * The invariant this must not break is the queue's: at most one unfinished PvP
 * game per player. `joinPvpQueue` resumes whatever live game it finds rather
 * than pairing again, so a second live game would strand one of them. Accepting
 * therefore refuses when either side already has one, inside the same
 * serializable transaction that creates the game.
 */

/** How long a challenge stands before it stops being acceptable. */
const CHALLENGE_TTL_MS = 60 * 60_000;

/**
 * A ceiling on outstanding challenges per player. Not a rate limit — the route
 * has one of those — but a cap on how much of someone else's inbox one player
 * can occupy.
 */
const MAX_PENDING_CHALLENGES = 10;

/** Postgres could not serialize a concurrent transaction. */
const SERIALIZATION_FAILURE = "P2034";
const UNIQUE_VIOLATION = "P2002";

/**
 * The alphabet for join codes: no `0`/`O`, no `1`/`I`/`L`. A code exists to be
 * read aloud and typed back, and those are the pairs that get typed back wrong.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;

function generateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export type ChallengeView = {
  id: string;
  code: string;
  /** True when the caller is the one who sent it. */
  outgoing: boolean;
  challenger: { username: string; rating: number; title: string | null };
  /** Null on an open challenge. */
  challenged: { username: string } | null;
  /** The colour the challenger asked for. */
  color: ChallengeColor;
  timeControl: TimeControlKey | null;
  status: ChallengeRow["status"];
  gameId: string | null;
  createdAt: string;
  expiresAt: string;
};

type ChallengeWithPeople = ChallengeRow & {
  challenger: {
    username: string;
    equippedTitle: { label: string } | null;
    stats: { rating: number } | null;
  };
  challenged: { username: string } | null;
};

const WITH_PEOPLE = {
  challenger: {
    select: {
      username: true,
      equippedTitle: { select: { label: true } },
      stats: { select: { rating: true } },
    },
  },
  challenged: { select: { username: true } },
} as const;

function view(row: ChallengeWithPeople, userId: string): ChallengeView {
  return {
    id: row.id,
    code: row.code,
    outgoing: row.challengerId === userId,
    challenger: {
      username: row.challenger.username,
      rating: row.challenger.stats?.rating ?? 1200,
      title: row.challenger.equippedTitle?.label ?? null,
    },
    challenged: row.challenged ? { username: row.challenged.username } : null,
    color: row.color,
    timeControl: toTimeControlKey(row.clock),
    status: row.status,
    gameId: row.gameId,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/**
 * Send a challenge.
 *
 * With `opponentUsername` it lands in that player's inbox; without one it is
 * open, and its code is the only way in.
 */
export async function createChallenge(input: {
  user: User;
  opponentUsername?: string | null;
  color?: ChallengeColor;
  timeControl?: TimeControlKey | null;
}): Promise<ChallengeView> {
  let challengedId: string | null = null;

  if (input.opponentUsername) {
    const opponent = await db.user.findUnique({
      where: { username: input.opponentUsername },
      select: { id: true },
    });

    if (!opponent) {
      throwProblem(
        HttpStatusCodes.NOT_FOUND,
        `No player called "${input.opponentUsername}"`,
      );
    }

    if (opponent.id === input.user.id) {
      throwProblem(
        HttpStatusCodes.UNPROCESSABLE_ENTITY,
        "You cannot challenge yourself",
      );
    }

    challengedId = opponent.id;
  }

  const pending = await db.challenge.count({
    where: {
      challengerId: input.user.id,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
  });

  if (pending >= MAX_PENDING_CHALLENGES) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have ${pending} challenges still outstanding. Cancel one before sending another.`,
    );
  }

  // A duplicate outstanding challenge to the same person is noise in their
  // inbox, not a second game. Reuse the one already standing.
  if (challengedId !== null) {
    const existing = await db.challenge.findFirst({
      where: {
        challengerId: input.user.id,
        challengedId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      include: WITH_PEOPLE,
    });

    if (existing) {
      return view(existing, input.user.id);
    }
  }

  // Codes are random and unique; a collision is a retry, not an error. Six
  // characters from a 31-letter alphabet is ~900M codes, so this loop is a
  // formality that will effectively never run twice.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const row = await db.challenge.create({
        data: {
          code: generateCode(),
          challengerId: input.user.id,
          challengedId,
          color: input.color ?? "RANDOM",
          clock: toClockPreset(input.timeControl),
          expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        },
        include: WITH_PEOPLE,
      });

      return view(row, input.user.id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        continue;
      }
      throw error;
    }
  }

  throwProblem(
    HttpStatusCodes.INTERNAL_SERVER_ERROR,
    "Could not allocate a challenge code",
  );
}

/**
 * Challenge the opponent of a game you just finished to another one.
 *
 * Same clock, colours swapped — which is what "rematch" means at a board and
 * what stops the player who drew white keeping it forever.
 */
export async function createRematch(input: {
  user: User;
  gameId: string;
}): Promise<ChallengeView> {
  const game = await db.game.findUnique({ where: { id: input.gameId } });

  if (!game) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  if (game.mode !== "PVP") {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "Only an online game has an opponent to rematch. Start another AI game instead.",
    );
  }

  const yourColor =
    game.whitePlayerId === input.user.id
      ? "w"
      : game.blackPlayerId === input.user.id
        ? "b"
        : null;

  if (yourColor === null) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      "You are not a player in this game",
    );
  }

  if (game.endedAt === null) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "This game is still going. Finish it before asking for a rematch.",
    );
  }

  const opponentId =
    yourColor === "w" ? game.blackPlayerId : game.whitePlayerId;

  if (!opponentId) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "Your opponent's account is gone; there is nobody to rematch.",
    );
  }

  const opponent = await db.user.findUnique({
    where: { id: opponentId },
    select: { username: true },
  });

  if (!opponent) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "Your opponent's account is gone; there is nobody to rematch.",
    );
  }

  // The clock is read back off the game rather than trusted from the client, so
  // a rematch of a blitz game is a blitz game.
  const timeControl = timeControlOf(game.initialSeconds, game.incrementSeconds);

  return createChallenge({
    user: input.user,
    opponentUsername: opponent.username,
    // Swapped: whoever had black asks for white.
    color: yourColor === "w" ? "BLACK" : "WHITE",
    timeControl,
  });
}

/**
 * The preset a game's stored clock numbers name, or null when the game was
 * untimed — or when its numbers match no current preset, which a rematch can
 * only honestly treat as untimed.
 */
function timeControlOf(
  initialSeconds: number | null,
  incrementSeconds: number | null,
): TimeControlKey | null {
  if (initialSeconds === null || incrementSeconds === null) {
    return null;
  }

  return timeControlFor(initialSeconds, incrementSeconds)?.key ?? null;
}

export type ChallengeList = {
  incoming: ChallengeView[];
  outgoing: ChallengeView[];
};

/** What is waiting for you, and what you are waiting on. */
export async function listChallenges(user: User): Promise<ChallengeList> {
  const now = new Date();

  const [incoming, outgoing] = await Promise.all([
    db.challenge.findMany({
      where: {
        challengedId: user.id,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: WITH_PEOPLE,
    }),
    db.challenge.findMany({
      where: {
        challengerId: user.id,
        // Accepted ones stay in the list: an outgoing challenge that just
        // became a game is exactly what the sender is polling to find out.
        status: { in: ["PENDING", "ACCEPTED"] },
        OR: [{ status: "ACCEPTED" }, { expiresAt: { gt: now } }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: WITH_PEOPLE,
    }),
  ]);

  return {
    incoming: incoming.map((row) => view(row, user.id)),
    outgoing: outgoing.map((row) => view(row, user.id)),
  };
}

/** One challenge by its join code — how a typed-in code becomes something to accept. */
export async function findChallengeByCode(
  user: User,
  code: string,
): Promise<ChallengeView> {
  const row = await db.challenge.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: WITH_PEOPLE,
  });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No challenge with that code");
  }

  return view(row, user.id);
}

/**
 * Accept a challenge, creating the game.
 *
 * Serializable, and it re-checks everything inside the transaction: two players
 * racing to accept the same open code must produce one game, and a player who
 * started a queue game in the meantime must not end up with two.
 */
export async function acceptChallenge(input: {
  user: User;
  challengeId: string;
}): Promise<{ challenge: ChallengeView; game: GameView }> {
  let gameId: string;
  let challenge: ChallengeWithPeople;

  try {
    const result = await db.$transaction(
      async (tx) => {
        const row = await tx.challenge.findUnique({
          where: { id: input.challengeId },
          include: WITH_PEOPLE,
        });

        if (!row) {
          throwProblem(HttpStatusCodes.NOT_FOUND, "No such challenge");
        }

        if (row.challengerId === input.user.id) {
          throwProblem(
            HttpStatusCodes.CONFLICT,
            "This is your own challenge. Wait for someone to take it.",
          );
        }

        // An addressed challenge admits exactly one player; an open one admits
        // whoever gets there first.
        if (row.challengedId !== null && row.challengedId !== input.user.id) {
          throwProblem(
            HttpStatusCodes.FORBIDDEN,
            "This challenge was sent to someone else",
          );
        }

        if (row.status !== "PENDING") {
          throwProblem(
            HttpStatusCodes.CONFLICT,
            `This challenge was already ${row.status.toLowerCase()}`,
          );
        }

        // Checked against the clock rather than trusting a sweeper to have run.
        if (row.expiresAt.getTime() <= Date.now()) {
          throwProblem(HttpStatusCodes.CONFLICT, "This challenge has expired");
        }

        const clash = await tx.game.findFirst({
          where: {
            mode: "PVP",
            endedAt: null,
            OR: [
              { whitePlayerId: { in: [row.challengerId, input.user.id] } },
              { blackPlayerId: { in: [row.challengerId, input.user.id] } },
            ],
          },
        });

        if (clash) {
          throwProblem(
            HttpStatusCodes.CONFLICT,
            "One of you already has an online game under way. Finish it first.",
          );
        }

        const challengerIsWhite =
          row.color === "WHITE"
            ? true
            : row.color === "BLACK"
              ? false
              : Math.random() < 0.5;

        const timeControl = toTimeControlKey(row.clock);

        const game = await tx.game.create({
          data: {
            mode: "PVP",
            whitePlayerId: challengerIsWhite ? row.challengerId : input.user.id,
            blackPlayerId: challengerIsWhite ? input.user.id : row.challengerId,
            moves: [],
            currentFen: toFen(createGame().position),
            ...initialClockData(timeControl),
          },
        });

        const accepted = await tx.challenge.update({
          where: { id: row.id },
          data: {
            status: "ACCEPTED",
            gameId: game.id,
            // An addressed challenge already names them; an open one records
            // who actually walked through the door.
            challengedId: input.user.id,
            respondedAt: new Date(),
          },
          include: WITH_PEOPLE,
        });

        return { gameId: game.id, challenge: accepted };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    gameId = result.gameId;
    challenge = result.challenge;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === SERIALIZATION_FAILURE
    ) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Someone accepted this challenge at the same moment. Refresh and try again.",
      );
    }
    throw error;
  }

  // Both players now have a game, so neither should still be sitting in the
  // queue waiting for a different one.
  await Promise.all([
    matchmaking.leave(input.user.id),
    matchmaking.leave(challenge.challengerId),
  ]);

  // The challenger may already be watching this game's stream, having polled
  // its way in from the challenge list.
  publishGameChanged(gameId);

  return {
    challenge: view(challenge, input.user.id),
    game: await getGame(gameId, input.user),
  };
}

/** Turn a challenge down. Idempotent for the player it was addressed to. */
export async function declineChallenge(input: {
  user: User;
  challengeId: string;
}): Promise<ChallengeView> {
  const row = await db.challenge.findUnique({
    where: { id: input.challengeId },
    include: WITH_PEOPLE,
  });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such challenge");
  }

  if (row.challengedId !== input.user.id) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      "This challenge was not sent to you",
    );
  }

  if (row.status !== "PENDING") {
    return view(row, input.user.id);
  }

  const declined = await db.challenge.update({
    where: { id: row.id },
    data: { status: "DECLINED", respondedAt: new Date() },
    include: WITH_PEOPLE,
  });

  return view(declined, input.user.id);
}

/** Withdraw a challenge you sent. Idempotent, like declining. */
export async function cancelChallenge(input: {
  user: User;
  challengeId: string;
}): Promise<ChallengeView> {
  const row = await db.challenge.findUnique({
    where: { id: input.challengeId },
    include: WITH_PEOPLE,
  });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such challenge");
  }

  if (row.challengerId !== input.user.id) {
    throwProblem(HttpStatusCodes.FORBIDDEN, "This is not your challenge");
  }

  if (row.status !== "PENDING") {
    return view(row, input.user.id);
  }

  const cancelled = await db.challenge.update({
    where: { id: row.id },
    data: { status: "CANCELLED", respondedAt: new Date() },
    include: WITH_PEOPLE,
  });

  return view(cancelled, input.user.id);
}
