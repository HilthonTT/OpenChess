import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import { createPlayerRouter } from "../lib/create-app";
import { problemDetailsContent } from "../lib/problem-details";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  addRepertoireLine,
  getRepertoireLine,
  listRepertoire,
  nextDueLine,
  removeRepertoireLine,
  reviewRepertoireLine,
} from "../repertoire/service";
import {
  addRepertoireLineSchema,
  idParamsSchema,
  repertoireLineSchema,
  repertoireReviewResultSchema,
  reviewRepertoireLineSchema,
} from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

base.use(
  "*",
  requireAuth,
  requireUser,
  rateLimit({ windowMs: 60_000, max: 60 }),
);

const unauthorized = problemDetailsContent("Not signed in");
const notFound = problemDetailsContent("No such line");

const list = createRoute({
  tags: [TAGS.REPERTOIRE],
  method: "get",
  path: "/",
  summary: "Your repertoire",
  description:
    "Every line you keep, soonest due first — which for a queue with anything overdue in it is the thing you have been putting off longest. `due` says whether a line is ready now; `yourMoves` is how many of its moves you would actually have to find, which is what a drill asks for and what a review is paid on.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ lines: z.array(repertoireLineSchema) }),
      "The lines",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const next = createRoute({
  tags: [TAGS.REPERTOIRE],
  method: "get",
  path: "/next",
  summary: "The line to drill next",
  description:
    "The soonest-due line that is actually due, or null when nothing is. Null rather than the next line along on purpose: the point of a schedule is that it says when to stop, and a trainer that always has one more line never tells you you are finished. Drilling ahead is still possible — it is just something you ask for, by naming a line.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ line: repertoireLineSchema.nullable() }),
      "A line, or null when the queue is empty",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const add = createRoute({
  tags: [TAGS.REPERTOIRE],
  method: "post",
  path: "/",
  summary: "Keep a line",
  description:
    "Adds a line to your repertoire, due immediately. `moves` is SAN from the initial array — the form the opening book is written in, so a line walked in the explorer can be sent exactly as it was walked. It is replayed through the engine before anything is stored, and the engine's own spelling of each move is what gets written: `Nf3`, `Nf3+` and `Ng1f3` are one move, and three spellings of it would otherwise be three lines to drill. Adding a line you already keep returns the one you have rather than failing, so pressing the key twice is harmless.",
  request: {
    body: jsonContentRequired(addRepertoireLineSchema, "The line to keep"),
  },
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent(
      z.object({ line: repertoireLineSchema, added: z.boolean() }),
      "The line, and whether this call is what added it",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "Your repertoire is full",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "That line does not play out, is too long, or holds no move of yours",
    ),
  },
});

const read = createRoute({
  tags: [TAGS.REPERTOIRE],
  method: "get",
  path: "/{id}",
  summary: "One line",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(repertoireLineSchema, "The line"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const remove = createRoute({
  tags: [TAGS.REPERTOIRE],
  method: "delete",
  path: "/{id}",
  summary: "Drop a line",
  description:
    "Removes it from your repertoire and from the queue. Somebody else's line reports as missing rather than as forbidden — a repertoire is private, and telling a stranger that an id exists tells them something about a player who did not ask to be asked.",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.NO_CONTENT]: { description: "Dropped" },
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const review = createRoute({
  tags: [TAGS.REPERTOIRE],
  method: "post",
  path: "/{id}/review",
  summary: "Record a drill",
  description:
    "Reports how the drill went and reschedules the line. One wrong move fails the whole line however long it was — an opening line is a sequence, and half of one is not half as useful — and a failed line comes back the same day with its ease reduced. A clean run is graded `easy` or `good` on the time it took, and pushes the next review out.\n\nOnly a review of a line that was **due** pays XP. Drilling ahead is free, unlimited and worth nothing, which is the right price for practice you asked for — and, with the interval always at least a day after a clean run, is also what stops a line being farmed.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(reviewRepertoireLineSchema, "How it went"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      repertoireReviewResultSchema,
      "The rescheduled line, its grade, and what it paid",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const router = base
  .openapi(next, async (c) => {
    const line = await nextDueLine(c.get("user"));

    return c.json({ line }, HttpStatusCodes.OK);
  })
  .openapi(list, async (c) => {
    const lines = await listRepertoire(c.get("user"));

    return c.json({ lines }, HttpStatusCodes.OK);
  })
  .openapi(add, async (c) => {
    const body = c.req.valid("json");

    const result = await addRepertoireLine(c.get("user"), body);

    return c.json(result, HttpStatusCodes.CREATED);
  })
  .openapi(review, async (c) => {
    const { id } = c.req.valid("param");
    const { mistakes, msSpent } = c.req.valid("json");

    const result = await reviewRepertoireLine(c.get("user"), id, {
      mistakes,
      msSpent: msSpent ?? null,
    });

    return c.json(result, HttpStatusCodes.OK);
  })
  .openapi(read, async (c) => {
    const { id } = c.req.valid("param");

    const line = await getRepertoireLine(c.get("user"), id);

    return c.json(line, HttpStatusCodes.OK);
  })
  .openapi(remove, async (c) => {
    const { id } = c.req.valid("param");

    await removeRepertoireLine(c.get("user"), id);

    return c.body(null, HttpStatusCodes.NO_CONTENT);
  });

export default router;
