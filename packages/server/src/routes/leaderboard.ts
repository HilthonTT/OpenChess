import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";

import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import { getLeaderboard } from "../player/service";
import { leaderboardEntrySchema } from "./schemas";

const router = createPlayerRouter();

router.use("*", requireAuth, requireUser);

const board = createRoute({
  tags: ["Leaderboard"],
  method: "get",
  path: "/",
  summary: "Ranked players",
  description:
    "Offset-paginated, because a rank is only meaningful as an absolute position. Each sort lands on an index the schema already carries.",
  request: {
    query: z.object({
      sort: z.enum(["rating", "level", "wins"]).default("rating"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        entries: z.array(leaderboardEntrySchema),
        total: z.number().int(),
        page: z.number().int(),
      }),
      "A page of the leaderboard",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: problemDetailsContent("Not authenticated"),
  },
});

router.openapi(board, async (c) => {
  const { sort, page, limit } = c.req.valid("query");

  const result = await getLeaderboard({
    user: c.get("user"),
    sort,
    page,
    limit,
  });

  return c.json(result, HttpStatusCodes.OK);
});

export default router;
