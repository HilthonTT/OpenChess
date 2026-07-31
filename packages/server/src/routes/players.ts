import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";

import { createPlayerRouter } from "../lib/create-app";
import { withPlayerLinks } from "../lib/hateoas";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import { getPublicProfile, searchPlayers } from "../player/profiles";
import {
  playerSearchResultSchema,
  publicProfileSchema,
  usernameParamsSchema,
} from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

base.use("*", requireAuth, requireUser);

const unauthorized = problemDetailsContent("Not authenticated");

const search = createRoute({
  tags: [TAGS.PLAYERS],
  method: "get",
  path: "/",
  summary: "Find players by name",
  description:
    "A prefix match on the username, case-insensitive, capped at ten. A prefix rather than a substring on purpose: it is what someone typing a name they already know needs, and a substring search over every account would be both slow and a way to enumerate the player base. An empty `q` returns nothing rather than everyone. Each row carries how you stand with that player, so a client knows whether to offer 'add friend' or 'challenge'.",
  request: {
    query: z.object({
      q: z.string().max(32).default(""),
      limit: z.coerce.number().int().min(1).max(10).default(10),
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ players: z.array(playerSearchResultSchema) }),
      "Matching players, by name",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const profile = createRoute({
  tags: [TAGS.PLAYERS],
  method: "get",
  path: "/{username}",
  summary: "Another player's profile",
  description:
    "What a player has made public by playing: their record, rating and curve, the title they are wearing, their recent games and how many achievements they hold. Deliberately a strict subset of `/me` — there is no wallet, no ledger and no account identity here. Fetching your own name works and reports `friendship.state` as `self`.",
  request: { params: usernameParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(publicProfileSchema, "Their profile"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: problemDetailsContent("No such player"),
  },
});

// Chained rather than registered as separate statements: `.openapi()` returns a
// router carrying the new route in its type, and that type is what `hc<AppType>`
// builds the typed CLI client from.
const router = base
  .openapi(search, async (c) => {
    const { q, limit } = c.req.valid("query");

    const players = await searchPlayers({
      user: c.get("user"),
      query: q,
      limit,
    });

    return c.json({ players }, HttpStatusCodes.OK);
  })
  .openapi(profile, async (c) => {
    const { username } = c.req.valid("param");

    const found = await getPublicProfile({ user: c.get("user"), username });

    return c.json(withPlayerLinks(found), HttpStatusCodes.OK);
  });

export default router;
