import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";

import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import { listAchievements } from "../player/service";
import { achievementSchema } from "./schemas";

const router = createPlayerRouter();

router.use("*", requireAuth, requireUser);

const catalog = createRoute({
  tags: ["Achievements"],
  method: "get",
  path: "/",
  summary: "The achievement catalog",
  description:
    "Every achievement, carrying your own `unlockedAt` where you have earned it. Secret achievements you have not unlocked are withheld entirely.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ achievements: z.array(achievementSchema) }),
      "The catalog",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: problemDetailsContent("Not authenticated"),
  },
});

router.openapi(catalog, async (c) => {
  const achievements = await listAchievements(c.get("user"));

  return c.json({ achievements }, HttpStatusCodes.OK);
});

export default router;
