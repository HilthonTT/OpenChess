import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";

import { createPlayerRouter } from "../lib/create-app";
import {
  API_PATHS,
  offsetPageLinks,
  offsetPageLinksSchema,
} from "../lib/hateoas";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import { getLeaderboard } from "../player/service";
import { leaderboardEntrySchema } from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

base.use("*", requireAuth, requireUser);

const board = createRoute({
  tags: [TAGS.LEADERBOARD],
  method: "get",
  path: "/",
  summary: "Ranked players",
  description:
    "Offset-paginated, because a rank is only meaningful as an absolute position. Each sort lands on an index the schema already carries.",
  request: {
    query: z.object({
      sort: z.enum(["rating", "level", "wins"]).default("rating"),
      // Bounded because the page becomes an OFFSET: an astronomical value is
      // a full-table scan on request, and past 2^53 the arithmetic itself
      // breaks. No leaderboard anyone reads is ten thousand pages deep.
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        entries: z.array(leaderboardEntrySchema),
        total: z.number().int(),
        page: z.number().int(),
        _links: offsetPageLinksSchema,
      }),
      "A page of the leaderboard",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: problemDetailsContent("Not authenticated"),
  },
});

// Chained so the exported type carries the route — `hc<AppType>` builds the
// typed CLI client from it, and a statement registration would leave it blind.
const router = base.openapi(board, async (c) => {
  const { sort, page, limit } = c.req.valid("query");

  const result = await getLeaderboard({
    user: c.get("user"),
    sort,
    page,
    limit,
  });

  return c.json(
    {
      ...result,
      _links: offsetPageLinks(
        API_PATHS.leaderboard,
        { sort, limit },
        { page: result.page, limit, total: result.total },
      ),
    },
    HttpStatusCodes.OK,
  );
});

export default router;
