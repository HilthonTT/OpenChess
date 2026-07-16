import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";

import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import { listTitles, purchaseTitle } from "../player/service";
import { idParamsSchema, titleSchema } from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

base.use("*", requireAuth, requireUser);

const unauthorized = problemDetailsContent("Not authenticated");

const catalog = createRoute({
  tags: [TAGS.STORE],
  method: "get",
  path: "/",
  summary: "The title catalog",
  description:
    "Every title, with your own `owned` and `affordable` state on each. Titles that are not purchasable are achievement rewards: listed, but not for sale.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ titles: z.array(titleSchema) }),
      "The catalog, cheapest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const purchase = createRoute({
  tags: [TAGS.STORE],
  method: "post",
  path: "/{id}/purchase",
  summary: "Buy a title",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ title: titleSchema, coins: z.number().int() }),
      "The title you bought, and your new balance",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "The title is not for sale, or your level is too low",
    ),
    [HttpStatusCodes.NOT_FOUND]: problemDetailsContent("No such title"),
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "You already own it, or cannot afford it",
    ),
  },
});

// Chained so the exported type carries the routes — `hc<AppType>` builds the
// typed CLI client from it, and statement registrations would leave it blind.
const router = base
  .openapi(catalog, async (c) => {
    const titles = await listTitles(c.get("user"));

    return c.json({ titles }, HttpStatusCodes.OK);
  })
  .openapi(purchase, async (c) => {
    const { id } = c.req.valid("param");

    const bought = await purchaseTitle(c.get("user"), id);

    return c.json(bought, HttpStatusCodes.OK);
  });

export default router;
