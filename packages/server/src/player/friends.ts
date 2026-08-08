import { Prisma, type FriendshipStatus, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { normalizeUsername } from "../lib/users";
import { presenceFor, type PresenceView } from "./presence";

/**
 * Friends.
 *
 * A friendship is one directed row — who asked, who was asked, and whether they
 * said yes. See the `Friendship` model for why it is one row rather than two,
 * and why the pair `(A,B)`/`(B,A)` cannot be constrained in the schema.
 *
 * The invariant this module owns is the one the schema cannot: **at most one
 * live row per unordered pair**. Every path that could create a second one
 * resolves it instead of adding to it —
 *
 * - Asking someone who has already asked you *accepts* their request. Two
 *   players who have each asked to be friends have agreed, and the order the
 *   two requests happened to land in is not a reason to leave them both
 *   pending. It is the same reading two simultaneous draw offers get.
 * - Asking someone you already asked returns the request already standing,
 *   rather than a second one in their list.
 * - Asking someone who declined you starts the request over, because a decline
 *   is an answer to one request and not a permanent verdict.
 *
 * The unique index is still the backstop under a race: two requests racing in
 * opposite directions can both find nothing and both try to insert, and the
 * loser retries the whole routine — at which point the winner's row is there to
 * be found and accepted.
 */

const UNIQUE_VIOLATION = "P2002";

/**
 * A ceiling on outstanding requests, mirroring the challenge cap. Not a rate
 * limit — the route has one — but a bound on how much of other people's lists
 * one player can occupy.
 */
const MAX_PENDING_REQUESTS = 50;

/** How many friends one account may hold. Generous; a guard, not a product decision. */
const MAX_FRIENDS = 500;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

/** The public face of a player, as a friend list row shows them. */
export type FriendView = {
  /** The friendship row, which is what accept/decline/remove address. */
  id: string;
  userId: string;
  username: string;
  /** The label of their equipped title, if any. */
  title: string | null;
  rating: number;
  level: number;
  presence: PresenceView;
  status: FriendshipStatus;
  /** True when the caller is the one who sent the request. */
  outgoing: boolean;
  createdAt: string;
};

export type FriendLists = {
  friends: FriendView[];
  /** Requests waiting on you. */
  incoming: FriendView[];
  /** Requests you are waiting on. */
  outgoing: FriendView[];
};

const WITH_PEOPLE = {
  requester: {
    select: {
      id: true,
      username: true,
      level: true,
      lastSeenAt: true,
      equippedTitle: { select: { label: true } },
      stats: { select: { rating: true } },
    },
  },
  addressee: {
    select: {
      id: true,
      username: true,
      level: true,
      lastSeenAt: true,
      equippedTitle: { select: { label: true } },
      stats: { select: { rating: true } },
    },
  },
} as const;

type FriendshipWithPeople = Prisma.FriendshipGetPayload<{
  include: typeof WITH_PEOPLE;
}>;

type Person = FriendshipWithPeople["requester"];

/** Whichever end of the row is not the caller. */
function otherSide(row: FriendshipWithPeople, userId: string): Person {
  return row.requesterId === userId ? row.addressee : row.requester;
}

function view(
  row: FriendshipWithPeople,
  userId: string,
  presence: Map<string, PresenceView>,
): FriendView {
  const person = otherSide(row, userId);

  return {
    id: row.id,
    userId: person.id,
    username: person.username,
    title: person.equippedTitle?.label ?? null,
    rating: person.stats?.rating ?? 0,
    level: person.level,
    presence: presence.get(person.id) ?? {
      state: "offline",
      lastSeenAt: person.lastSeenAt?.toISOString() ?? null,
    },
    status: row.status,
    outgoing: row.requesterId === userId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Resolve presence for every player named across a set of rows, in one pass. */
async function presenceAcross(
  rows: FriendshipWithPeople[],
  userId: string,
): Promise<Map<string, PresenceView>> {
  const people = new Map<string, Person>();

  for (const row of rows) {
    const person = otherSide(row, userId);
    people.set(person.id, person);
  }

  return presenceFor(
    [...people.values()].map((person) => ({
      id: person.id,
      lastSeenAt: person.lastSeenAt,
    })),
  );
}

/**
 * Your friends, and the requests at either end.
 *
 * One query for all three lists rather than three: the rows differ only by
 * status and direction, both of which are already on the row, and splitting
 * them would also mean resolving presence three times over an overlapping set
 * of people.
 */
export async function listFriends(user: User): Promise<FriendLists> {
  const rows = await db.friendship.findMany({
    where: {
      OR: [{ requesterId: user.id }, { addresseeId: user.id }],
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_FRIENDS + MAX_PENDING_REQUESTS * 2,
    include: WITH_PEOPLE,
  });

  const presence = await presenceAcross(rows, user.id);
  const rendered = rows.map((row) => view(row, user.id, presence));

  return {
    // Friends sort by presence and then by name: the list is read to find
    // somebody to play, so whoever can actually be played belongs at the top.
    friends: rendered
      .filter((row) => row.status === "ACCEPTED")
      .sort(byPresenceThenName),
    incoming: rendered.filter(
      (row) => row.status === "PENDING" && !row.outgoing,
    ),
    outgoing: rendered.filter(
      (row) => row.status === "PENDING" && row.outgoing,
    ),
  };
}

const PRESENCE_RANK: Record<PresenceView["state"], number> = {
  online: 0,
  playing: 1,
  offline: 2,
};

function byPresenceThenName(a: FriendView, b: FriendView): number {
  const rank =
    PRESENCE_RANK[a.presence.state] - PRESENCE_RANK[b.presence.state];
  return rank !== 0 ? rank : a.username.localeCompare(b.username);
}

/** The single row between two players, whichever direction it was written in. */
async function findBetween(
  a: string,
  b: string,
): Promise<FriendshipWithPeople | null> {
  return db.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    include: WITH_PEOPLE,
  });
}

/**
 * Ask someone to be friends — or answer the ask they already made.
 *
 * See the module comment for why the second reading exists. The return value
 * says which happened: an `ACCEPTED` row means the request was mutual and you
 * are friends now, not that anything was auto-approved on the other player's
 * behalf.
 */
export async function requestFriend(input: {
  user: User;
  username: string;
}): Promise<FriendView> {
  // Normalized, not compared case-insensitively — see `normalizeUsername`. This
  // is an index hit on `@unique`; `mode: "insensitive"` would be a table scan.
  const target = await db.user.findUnique({
    where: { username: normalizeUsername(input.username) },
    select: { id: true },
  });

  if (!target) {
    throwProblem(
      HttpStatusCodes.NOT_FOUND,
      `No player called "${input.username}"`,
    );
  }

  if (target.id === input.user.id) {
    throwProblem(
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      "You are already your own best friend",
    );
  }

  const existing = await findBetween(input.user.id, target.id);

  if (existing?.status === "ACCEPTED") {
    return single(existing, input.user.id);
  }

  if (existing?.status === "PENDING") {
    // Theirs: this request is the answer to it.
    if (existing.addresseeId === input.user.id) {
      return acceptFriend({ user: input.user, friendshipId: existing.id });
    }

    // Ours, already standing. Handing back the same row is what stops a player
    // filling somebody's list by pressing the key twice.
    return single(existing, input.user.id);
  }

  await assertCapacity(input.user.id);

  // A declined row is reused rather than left in the way: `@@unique` is on the
  // pair, so a fresh insert would collide with the decline forever, and a
  // decline is an answer to one request rather than a permanent verdict.
  if (existing) {
    const revived = await db.friendship.update({
      where: { id: existing.id },
      data: {
        // Rewritten to the current direction: whoever is asking now is the
        // requester, even if last time it was the other way round.
        requesterId: input.user.id,
        addresseeId: target.id,
        status: "PENDING",
        createdAt: new Date(),
        respondedAt: null,
      },
      include: WITH_PEOPLE,
    });

    return single(revived, input.user.id);
  }

  try {
    const created = await db.friendship.create({
      data: { requesterId: input.user.id, addresseeId: target.id },
      include: WITH_PEOPLE,
    });

    return single(created, input.user.id);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }

    // Two requests raced. Whichever one lost re-reads the row the winner wrote
    // and answers it, which is the same resolution the non-racing path takes.
    const winner = await findBetween(input.user.id, target.id);

    if (!winner) {
      throw error;
    }

    return winner.status === "PENDING" && winner.addresseeId === input.user.id
      ? acceptFriend({ user: input.user, friendshipId: winner.id })
      : single(winner, input.user.id);
  }
}

/** Refuse a request that would take either player past their limits. */
async function assertCapacity(userId: string): Promise<void> {
  const [pending, friends] = await Promise.all([
    db.friendship.count({ where: { requesterId: userId, status: "PENDING" } }),
    db.friendship.count({
      where: {
        status: "ACCEPTED",
        OR: [{ requesterId: userId }, { addresseeId: userId }],
      },
    }),
  ]);

  if (pending >= MAX_PENDING_REQUESTS) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have ${pending} friend requests still outstanding. Withdraw one before sending another.`,
    );
  }

  if (friends >= MAX_FRIENDS) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have reached the ${MAX_FRIENDS} friend limit. Remove someone before adding another.`,
    );
  }
}

/** Say yes. Idempotent for the player it was addressed to. */
export async function acceptFriend(input: {
  user: User;
  friendshipId: string;
}): Promise<FriendView> {
  const row = await load(input.friendshipId);

  if (row.addresseeId !== input.user.id) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      row.requesterId === input.user.id
        ? "This is your own request. Wait for them to answer it."
        : "This request was not sent to you",
    );
  }

  if (row.status === "ACCEPTED") {
    return single(row, input.user.id);
  }

  await assertCapacity(input.user.id);

  const accepted = await db.friendship.update({
    where: { id: row.id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
    include: WITH_PEOPLE,
  });

  return single(accepted, input.user.id);
}

/** Say no. Idempotent, and reversible — see `requestFriend`. */
export async function declineFriend(input: {
  user: User;
  friendshipId: string;
}): Promise<FriendView> {
  const row = await load(input.friendshipId);

  if (row.addresseeId !== input.user.id) {
    throwProblem(HttpStatusCodes.FORBIDDEN, "This request was not sent to you");
  }

  if (row.status !== "PENDING") {
    return single(row, input.user.id);
  }

  const declined = await db.friendship.update({
    where: { id: row.id },
    data: { status: "DECLINED", respondedAt: new Date() },
    include: WITH_PEOPLE,
  });

  return single(declined, input.user.id);
}

/**
 * Withdraw a request, or unfriend someone.
 *
 * One route for both because the row is the same row, and either end may end
 * it. The row is deleted rather than marked, so that either player can ask
 * again later from a clean slate — a `DECLINED` tombstone is the answer to a
 * question that was asked, and neither of these is that.
 */
export async function removeFriend(input: {
  user: User;
  friendshipId: string;
}): Promise<{ removed: true }> {
  const row = await load(input.friendshipId);

  if (row.requesterId !== input.user.id && row.addresseeId !== input.user.id) {
    throwProblem(HttpStatusCodes.FORBIDDEN, "This is not your friendship");
  }

  await db.friendship.delete({ where: { id: row.id } });

  return { removed: true };
}

async function load(friendshipId: string): Promise<FriendshipWithPeople> {
  const row = await db.friendship.findUnique({
    where: { id: friendshipId },
    include: WITH_PEOPLE,
  });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such friend request");
  }

  return row;
}

/** One row's view, with presence resolved for the one player it names. */
async function single(
  row: FriendshipWithPeople,
  userId: string,
): Promise<FriendView> {
  return view(row, userId, await presenceAcross([row], userId));
}

/**
 * How the caller stands with another player.
 *
 * `none` covers a declined row as well as no row at all: from the profile
 * screen's point of view they are the same offer — "you may ask" — and
 * reporting a decline back to the player who was declined is neither useful nor
 * kind.
 */
export type FriendshipState =
  | "self"
  | "friends"
  | "requestSent"
  | "requestReceived"
  | "none";

export type FriendshipStanding = {
  state: FriendshipState;
  /** The row to accept, decline or remove, when there is one. */
  friendshipId: string | null;
};

export async function friendshipWith(
  user: User,
  otherUserId: string,
): Promise<FriendshipStanding> {
  if (otherUserId === user.id) {
    return { state: "self", friendshipId: null };
  }

  const row = await findBetween(user.id, otherUserId);

  if (!row || row.status === "DECLINED") {
    return { state: "none", friendshipId: null };
  }

  if (row.status === "ACCEPTED") {
    return { state: "friends", friendshipId: row.id };
  }

  return {
    state: row.requesterId === user.id ? "requestSent" : "requestReceived",
    friendshipId: row.id,
  };
}

/** The ids of everyone the caller is friends with. */
export async function friendIds(userId: string): Promise<string[]> {
  const rows = await db.friendship.findMany({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
    take: MAX_FRIENDS,
  });

  return rows.map((row) =>
    row.requesterId === userId ? row.addresseeId : row.requesterId,
  );
}
