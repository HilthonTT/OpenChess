import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import {
  acceptChallenge,
  cancelChallenge,
  createChallenge,
  declineChallenge,
  findChallengeByCode,
  listChallenges,
} from "../game/challenges";
import { createPlayerRouter } from "../lib/create-app";
import { withChallengeLinks, withGameLinks } from "../lib/hateoas";
import { problemDetailsContent } from "../lib/problem-details";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  challengeCodeParamsSchema,
  challengeSchema,
  createChallengeSchema,
  gameSchema,
  idParamsSchema,
} from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

// Sending a challenge writes to someone else's inbox, so the limit here is
// tighter than the game routes': 30/min is far beyond any human, and well short
// of what it would take to flood anyone.
base.use("*", requireAuth, requireUser, rateLimit({ windowMs: 60_000, max: 30 }));

const unauthorized = problemDetailsContent("Not authenticated");
const notFound = problemDetailsContent("No such challenge");

const list = createRoute({
  tags: [TAGS.CHALLENGES],
  method: "get",
  path: "/",
  summary: "Your challenges",
  description:
    "What is waiting for you and what you are waiting on. Outgoing challenges stay listed once accepted — that is how the sender learns their game exists, so poll this while an offer is outstanding.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        incoming: z.array(challengeSchema),
        outgoing: z.array(challengeSchema),
      }),
      "Pending challenges, newest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const create = createRoute({
  tags: [TAGS.CHALLENGES],
  method: "post",
  path: "/",
  summary: "Challenge a player",
  description:
    "Name an `opponent` to put a challenge in their list, or omit it for an open challenge that anyone holding the returned `code` can accept. A repeated challenge to the same player returns the one already standing rather than sending a second.",
  request: {
    body: jsonContentRequired(createChallengeSchema, "The challenge to send"),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent(challengeSchema, "The challenge"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: problemDetailsContent("No such player"),
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "You have too many challenges outstanding",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "You cannot challenge yourself",
    ),
  },
});

// Registered ahead of `/{id}` so the literal segment wins the match.
const byCode = createRoute({
  tags: [TAGS.CHALLENGES],
  method: "get",
  path: "/code/{code}",
  summary: "Look a challenge up by its code",
  description:
    "Turns a code someone read out into a challenge you can accept. Case-insensitive.",
  request: { params: challengeCodeParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(challengeSchema, "The challenge"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: problemDetailsContent(
      "No challenge with that code",
    ),
  },
});

const accept = createRoute({
  tags: [TAGS.CHALLENGES],
  method: "post",
  path: "/{id}/accept",
  summary: "Accept a challenge",
  description:
    "Creates the game and hands it back, ready to play — the same online game the queue would have made, so the clock, the stream, rating and payouts are all unchanged. Refused when either player already has an online game under way: there is one live game per player, and a second would strand one of them.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ challenge: challengeSchema, game: gameSchema }),
      "The game to play",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "This challenge was sent to someone else",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "Already answered, expired, or one of you is already in a game",
    ),
  },
});

const decline = createRoute({
  tags: [TAGS.CHALLENGES],
  method: "post",
  path: "/{id}/decline",
  summary: "Decline a challenge",
  description:
    "Turns down a challenge sent to you. Declining one already answered returns it unchanged, so a retry is safe.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(challengeSchema, "The challenge"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "This challenge was not sent to you",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const cancel = createRoute({
  tags: [TAGS.CHALLENGES],
  method: "delete",
  path: "/{id}",
  summary: "Withdraw a challenge you sent",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(challengeSchema, "The challenge"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "This is not your challenge",
    ),
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const router = base
  .openapi(list, async (c) => {
    const { incoming, outgoing } = await listChallenges(c.get("user"));

    return c.json(
      {
        incoming: incoming.map(withChallengeLinks),
        outgoing: outgoing.map(withChallengeLinks),
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(create, async (c) => {
    const { opponent, color, timeControl } = c.req.valid("json");

    const challenge = await createChallenge({
      user: c.get("user"),
      opponentUsername: opponent ?? null,
      color,
      timeControl: timeControl ?? null,
    });

    return c.json(withChallengeLinks(challenge), HttpStatusCodes.CREATED);
  })
  .openapi(byCode, async (c) => {
    const { code } = c.req.valid("param");

    const challenge = await findChallengeByCode(c.get("user"), code);

    return c.json(withChallengeLinks(challenge), HttpStatusCodes.OK);
  })
  .openapi(accept, async (c) => {
    const { id } = c.req.valid("param");

    const { challenge, game } = await acceptChallenge({
      user: c.get("user"),
      challengeId: id,
    });

    return c.json(
      {
        challenge: withChallengeLinks(challenge),
        game: withGameLinks(game),
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(decline, async (c) => {
    const { id } = c.req.valid("param");

    const challenge = await declineChallenge({
      user: c.get("user"),
      challengeId: id,
    });

    return c.json(withChallengeLinks(challenge), HttpStatusCodes.OK);
  })
  .openapi(cancel, async (c) => {
    const { id } = c.req.valid("param");

    const challenge = await cancelChallenge({
      user: c.get("user"),
      challengeId: id,
    });

    return c.json(withChallengeLinks(challenge), HttpStatusCodes.OK);
  });

export default router;
