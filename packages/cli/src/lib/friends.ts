import type { InferResponseType } from "hono/client";
import { apiClient } from "./api-client";
import { GameConflictError } from "./games";
import { getProblemDetails, problemMessage } from "./http-errors";

/**
 * Typed calls to the server's `/friends` API. Like the `/challenges` helpers,
 * every call either returns the decoded body or throws an `Error` carrying the
 * server's problem detail, so screens can render `error.message` as-is.
 */

const byId = apiClient.friends[":id"];

export type FriendLists = InferResponseType<
  typeof apiClient.friends.$get,
  200
>;
export type Friend = FriendLists["friends"][number];
export type Presence = Friend["presence"];
export type PresenceState = Presence["state"];

async function toError(response: {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
}): Promise<Error> {
  const message = problemMessage(await getProblemDetails(response));

  // A 409 here is a limit reached — too many requests outstanding, too many
  // friends. The screens answer it the same way they answer any conflict: show
  // what the server said and refetch.
  return response.status === 409
    ? new GameConflictError(message)
    : new Error(message);
}

export async function listFriends(): Promise<FriendLists> {
  const response = await apiClient.friends.$get();

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/**
 * Ask someone to be friends.
 *
 * Asking a player who has already asked you accepts their request instead of
 * sending a second one, so a returned `status` of `ACCEPTED` means it was
 * mutual — worth saying out loud in the UI, because "friend added" and "request
 * sent" are different outcomes of the same keypress.
 */
export async function addFriend(username: string): Promise<Friend> {
  const response = await apiClient.friends.$post({
    json: { username: username.trim() },
  });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function acceptFriend(id: string): Promise<Friend> {
  const response = await byId.accept.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

export async function declineFriend(id: string): Promise<Friend> {
  const response = await byId.decline.$post({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }

  return response.json();
}

/** Withdraw a request you sent, or unfriend. One call, either reading. */
export async function removeFriend(id: string): Promise<void> {
  const response = await byId.$delete({ param: { id } });

  if (response.status !== 200) {
    throw await toError(response);
  }
}

/** How presence reads on a row, and the colour weight to give it. */
export const PRESENCE_LABEL: Record<PresenceState, string> = {
  playing: "in a game",
  online: "online",
  offline: "offline",
};

/**
 * "Last seen" in the coarsest unit that is still true.
 *
 * Presence is only accurate to about a minute, so a rendering to the second
 * would be claiming a precision the underlying column does not have.
 */
export function lastSeenLabel(presence: Presence): string {
  if (presence.state !== "offline") {
    return PRESENCE_LABEL[presence.state];
  }

  if (presence.lastSeenAt === null) {
    return "never seen";
  }

  const minutes = Math.floor(
    (Date.now() - new Date(presence.lastSeenAt).getTime()) / 60_000,
  );

  if (minutes < 60) {
    return `${Math.max(minutes, 1)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}
