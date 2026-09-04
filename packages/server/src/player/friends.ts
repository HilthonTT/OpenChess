import { Prisma, type FriendshipStatus, type User } from "@openchess/database";
import { db } from "@openchess/database/client";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { normalizeUsername } from "../lib/users";
import { presenceFor, type PresenceView } from "./presence";

const UNIQUE_VIOLATION = "P2002";

const MAX_PENDING_REQUESTS = 50;

const MAX_FRIENDS = 500;

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

export type FriendView = {
  id: string;
  userId: string;
  username: string;
  title: string | null;
  rating: number;
  level: number;
  presence: PresenceView;
  status: FriendshipStatus;
  outgoing: boolean;
  createdAt: string;
};

export type FriendLists = {
  friends: FriendView[];
  incoming: FriendView[];
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

export async function requestFriend(input: {
  user: User;
  username: string;
}): Promise<FriendView> {
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
    if (existing.addresseeId === input.user.id) {
      return acceptFriend({ user: input.user, friendshipId: existing.id });
    }

    return single(existing, input.user.id);
  }

  await assertCapacity(input.user.id);

  if (existing) {
    const revived = await db.friendship.update({
      where: { id: existing.id },
      data: {
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

    const winner = await findBetween(input.user.id, target.id);

    if (!winner) {
      throw error;
    }

    return winner.status === "PENDING" && winner.addresseeId === input.user.id
      ? acceptFriend({ user: input.user, friendshipId: winner.id })
      : single(winner, input.user.id);
  }
}

async function friendCount(userId: string): Promise<number> {
  return db.friendship.count({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });
}

async function assertFriendCapacity(
  userId: string,
  message: string,
): Promise<void> {
  if ((await friendCount(userId)) >= MAX_FRIENDS) {
    throwProblem(HttpStatusCodes.CONFLICT, message);
  }
}

async function assertCapacity(userId: string): Promise<void> {
  const [pending, friends] = await Promise.all([
    db.friendship.count({ where: { requesterId: userId, status: "PENDING" } }),
    friendCount(userId),
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

  await assertFriendCapacity(
    input.user.id,
    `You have reached the ${MAX_FRIENDS} friend limit. Remove someone before accepting another.`,
  );
  await assertFriendCapacity(
    row.requesterId,
    "They have reached their friend limit and cannot add anyone right now.",
  );

  const accepted = await db.friendship.update({
    where: { id: row.id },
    data: { status: "ACCEPTED", respondedAt: new Date() },
    include: WITH_PEOPLE,
  });

  return single(accepted, input.user.id);
}

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

async function single(
  row: FriendshipWithPeople,
  userId: string,
): Promise<FriendView> {
  return view(row, userId, await presenceAcross([row], userId));
}

export type FriendshipState =
  | "self"
  | "friends"
  | "requestSent"
  | "requestReceived"
  | "none";

export type FriendshipStanding = {
  state: FriendshipState;
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
