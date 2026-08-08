import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import { createPlayerRouter } from "../lib/create-app";
import { withFriendLinks } from "../lib/hateoas";
import { problemDetailsContent } from "../lib/problem-details";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  acceptFriend,
  declineFriend,
  listFriends,
  removeFriend,
  requestFriend,
} from "../player/friends";
import { addFriendSchema, friendSchema, idParamsSchema } from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

// The same limit the challenge routes carry, for the same reason: sending a
// request writes to someone else's list. 30/min is beyond any human and well
// short of what it would take to flood anyone.
base.use(
  "*",
  requireAuth,
  requireUser,
  rateLimit({ windowMs: 60_000, max: 30 }),
);

const unauthorized = problemDetailsContent("Not authenticated");
const notFound = problemDetailsContent("No such friend request");

const list = createRoute({
  tags: [TAGS.FRIENDS],
  method: "get",
  path: "/",
  summary: "Your friends, and the requests at either end",
  description:
    "`friends` are sorted by presence first — whoever can actually be played is at the top — and then by name. `incoming` is waiting on you; `outgoing` is waiting on them. Each row carries the other player's presence, which is derived from when they were last seen rather than from a connection, so it is accurate to about a minute.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        friends: z.array(friendSchema),
        incoming: z.array(friendSchema),
        outgoing: z.array(friendSchema),
      }),
      "Your friends and pending requests",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const add = createRoute({
  tags: [TAGS.FRIENDS],
  method: "post",
  path: "/",
  summary: "Ask a player to be friends",
  description:
    "Puts a request in their list. Asking someone who has already asked *you* accepts their request instead of adding a second one beside it — two players who have each asked have agreed — so a `status` of `ACCEPTED` on the response means it was mutual, not that anything was approved on their behalf. Asking again while your own request stands returns the one already sent.",
  request: {
    body: jsonContentRequired(addFriendSchema, "Who to ask"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      friendSchema,
      "The request, or the friendship it completed",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: problemDetailsContent("No such player"),
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "You have too many requests outstanding, or too many friends",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "You cannot befriend yourself",
    ),
  },
});

const accept = createRoute({
  tags: [TAGS.FRIENDS],
  method: "post",
  path: "/{id}/accept",
  summary: "Accept a friend request",
  description:
    "Accepting one already accepted returns it unchanged, so a retry is safe.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(friendSchema, "Your new friend"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "This request was not sent to you",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "You have too many friends",
    ),
  },
});

const decline = createRoute({
  tags: [TAGS.FRIENDS],
  method: "post",
  path: "/{id}/decline",
  summary: "Decline a friend request",
  description:
    "Turns the request down. Not permanent: either of you may ask again, and a later request simply starts the question over.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(friendSchema, "The declined request"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "This request was not sent to you",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const remove = createRoute({
  tags: [TAGS.FRIENDS],
  method: "delete",
  path: "/{id}",
  summary: "Withdraw a request, or unfriend",
  description:
    "One route for both readings, because it is one row and either player may end it. The row is deleted rather than tombstoned, so either of you can ask again from a clean slate.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ removed: z.literal(true) }),
      "Gone",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "This is not your friendship",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

// Chained rather than registered as separate statements: `.openapi()` returns a
// router carrying the new route in its type, and that type is what `hc<AppType>`
// builds the typed CLI client from.
const router = base
  .openapi(list, async (c) => {
    const lists = await listFriends(c.get("user"));

    return c.json(
      {
        friends: lists.friends.map(withFriendLinks),
        incoming: lists.incoming.map(withFriendLinks),
        outgoing: lists.outgoing.map(withFriendLinks),
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(add, async (c) => {
    const { username } = c.req.valid("json");

    const friend = await requestFriend({ user: c.get("user"), username });

    return c.json(withFriendLinks(friend), HttpStatusCodes.OK);
  })
  .openapi(accept, async (c) => {
    const { id } = c.req.valid("param");

    const friend = await acceptFriend({
      user: c.get("user"),
      friendshipId: id,
    });

    return c.json(withFriendLinks(friend), HttpStatusCodes.OK);
  })
  .openapi(decline, async (c) => {
    const { id } = c.req.valid("param");

    const friend = await declineFriend({
      user: c.get("user"),
      friendshipId: id,
    });

    return c.json(withFriendLinks(friend), HttpStatusCodes.OK);
  })
  .openapi(remove, async (c) => {
    const { id } = c.req.valid("param");

    return c.json(
      await removeFriend({ user: c.get("user"), friendshipId: id }),
      HttpStatusCodes.OK,
    );
  });

export default router;
