import { createRoute, z } from "@hono/zod-openapi";
import { createPlayerRouter } from "../lib/create-app";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import jsonContent from "stoker/openapi/helpers/json-content";
import * as HttpStatusCodes from "stoker/http-status-codes";
import { problemDetailsContent, throwProblem } from "../lib/problem-details";
import {
  createCheckoutUrl,
  createCustomerPortalUrl,
  hasActiveSubscription,
} from "../lib/polar";
import { TAGS } from "./tags";

const base = createPlayerRouter();

const guards = [
  requireAuth,
  requireUser,
  rateLimit({ windowMs: 60_000, max: 10 }),
] as const;

base.use("/checkout", ...guards);
base.use("/portal", ...guards);
base.use("/status", ...guards);

const checkout = createRoute({
  tags: [TAGS.BILLING],
  method: "post",
  path: "/checkout",
  summary: "The polar-sh checkout",
  description: "",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        url: z.url(),
      }),
      "The checkout url",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: problemDetailsContent("Not authenticated"),
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "You already have an active subscription",
    ),
    [HttpStatusCodes.TOO_MANY_REQUESTS]: problemDetailsContent(
      "Too many billing requests; retry after the window resets",
    ),
  },
});

const portal = createRoute({
  tags: [TAGS.BILLING],
  method: "post",
  path: "/portal",
  summary: "The polar-sh portal",
  description: "",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        url: z.url(),
      }),
      "The portal url",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: problemDetailsContent("Not authenticated"),
    [HttpStatusCodes.TOO_MANY_REQUESTS]: problemDetailsContent(
      "Too many billing requests; retry after the window resets",
    ),
  },
});

const status = createRoute({
  tags: [TAGS.BILLING],
  method: "get",
  path: "/status",
  summary: "Your subscription status",
  description:
    "Whether you hold an active Polar subscription. Lets a client send subscribers to the billing portal instead of a second checkout.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        premium: z.boolean(),
      }),
      "Whether you have an active subscription",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: problemDetailsContent("Not authenticated"),
    [HttpStatusCodes.TOO_MANY_REQUESTS]: problemDetailsContent(
      "Too many billing requests; retry after the window resets",
    ),
  },
});

const success = createRoute({
  tags: [TAGS.BILLING],
  method: "get",
  path: "/success",
  summary: "The polar-sh success endpoint",
  description:
    "Polar redirects the customer's browser here after checkout. Public by necessity: that browser has no access token.",
  responses: {
    [HttpStatusCodes.OK]: {
      content: { "text/html": { schema: z.string() } },
      description: "A page telling the customer they can close the tab",
    },
  },
});

const SUCCESS_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Payment complete — OpenChess</title>
  </head>
  <body>
    <main>
      <h1>Payment complete</h1>
      <p>You can close this tab and return to OpenChess.</p>
    </main>
  </body>
</html>
`;

const router = base
  .openapi(checkout, async (c) => {
    const user = c.get("user");

    if (await hasActiveSubscription(user.id)) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "You already have an active subscription. Use the billing portal to manage it.",
      );
    }

    const url = await createCheckoutUrl(user.id);
    const result = { url };

    return c.json(result, HttpStatusCodes.OK);
  })
  .openapi(portal, async (c) => {
    const user = c.get("user");

    const url = await createCustomerPortalUrl(user.id);
    const result = { url };

    return c.json(result, HttpStatusCodes.OK);
  })
  .openapi(status, async (c) => {
    const user = c.get("user");

    const premium = await hasActiveSubscription(user.id);

    return c.json({ premium }, HttpStatusCodes.OK);
  })
  .openapi(success, (c) => {
    return c.html(SUCCESS_PAGE, HttpStatusCodes.OK);
  });

export default router;
