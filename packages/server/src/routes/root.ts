import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";

import { createRouter } from "../lib/create-app";
import { rootLinks, rootLinksSchema } from "../lib/hateoas";
import { TAGS } from "./tags";

const base = createRouter();

const index = createRoute({
  tags: [TAGS.ROOT],
  method: "get",
  path: "/",
  summary: "The API entry point",
  description:
    "Links to every top-level resource, so a client can start from one known URL and follow its nose. Each resource in turn carries a `_links` member naming the requests it supports in its current state.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ _links: rootLinksSchema }),
      "Where everything lives",
    ),
  },
});

const router = base.openapi(index, (c) => {
  return c.json({ _links: rootLinks() }, HttpStatusCodes.OK);
});

export default router;
