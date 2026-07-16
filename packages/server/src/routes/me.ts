import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  equipTitle,
  getProfile,
  getStats,
  listAchievements,
  listOwnedTitles,
  listTransactions,
} from "../player/service";
import {
  achievementSchema,
  equipTitleSchema,
  paginationQuerySchema,
  profileSchema,
  statsSchema,
  titleSchema,
  transactionSchema,
} from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

base.use("*", requireAuth, requireUser);

const unauthorized = problemDetailsContent("Not authenticated");

const profile = createRoute({
  tags: [TAGS.ME],
  method: "get",
  path: "/",
  summary: "Your profile and wallet",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(profileSchema, "Your profile"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const stats = createRoute({
  tags: [TAGS.ME],
  method: "get",
  path: "/stats",
  summary: "Your record, streaks and rating",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(statsSchema, "Your stats"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const achievements = createRoute({
  tags: [TAGS.ME],
  method: "get",
  path: "/achievements",
  summary: "Achievements you have unlocked",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ achievements: z.array(achievementSchema) }),
      "Your unlocked achievements",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const titles = createRoute({
  tags: [TAGS.ME],
  method: "get",
  path: "/titles",
  summary: "Titles you own",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        titles: z.array(
          titleSchema.extend({
            pricePaid: z.number().int(),
            purchasedAt: z.string(),
          }),
        ),
      }),
      "Your titles, most recently bought first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const equip = createRoute({
  tags: [TAGS.ME],
  method: "put",
  path: "/title",
  summary: "Equip a title",
  description: "Pass a null `titleId` to display no title at all.",
  request: {
    body: jsonContentRequired(equipTitleSchema, "The title to display"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(profileSchema, "Your updated profile"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.FORBIDDEN]: problemDetailsContent(
      "You do not own that title",
    ),
  },
});

const transactions = createRoute({
  tags: [TAGS.ME],
  method: "get",
  path: "/transactions",
  summary: "Your coin ledger",
  request: {
    query: paginationQuerySchema.extend({
      reason: z
        .enum(["GAME_REWARD", "ACHIEVEMENT", "PURCHASE", "ADMIN_GRANT"])
        .optional(),
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        transactions: z.array(transactionSchema),
        nextCursor: z.string().nullable(),
      }),
      "A page of ledger entries, newest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

// Chained rather than registered as separate statements: `.openapi()` returns a
// router carrying the new route in its type, so only the chained value knows the
// full shape. That type is what `hc<AppType>` builds the typed CLI client from.
const router = base
  .openapi(profile, async (c) => {
    return c.json(await getProfile(c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(stats, async (c) => {
    return c.json(await getStats(c.get("user")), HttpStatusCodes.OK);
  })
  .openapi(achievements, async (c) => {
    const unlocked = await listAchievements(c.get("user"), true);

    return c.json({ achievements: unlocked }, HttpStatusCodes.OK);
  })
  .openapi(titles, async (c) => {
    const owned = await listOwnedTitles(c.get("user"));

    return c.json({ titles: owned }, HttpStatusCodes.OK);
  })
  .openapi(equip, async (c) => {
    const { titleId } = c.req.valid("json");

    const updated = await equipTitle(c.get("user"), titleId);

    return c.json(updated, HttpStatusCodes.OK);
  })
  .openapi(transactions, async (c) => {
    const { cursor, limit, reason } = c.req.valid("query");

    const page = await listTransactions({
      user: c.get("user"),
      limit,
      cursor: cursor ? new Date(cursor) : undefined,
      reason,
    });

    return c.json(page, HttpStatusCodes.OK);
  });

export default router;
