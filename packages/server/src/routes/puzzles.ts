import { createRoute, z } from "@hono/zod-openapi";
import * as HttpStatusCodes from "stoker/http-status-codes";
import jsonContent from "stoker/openapi/helpers/json-content";
import jsonContentRequired from "stoker/openapi/helpers/json-content-required";

import { createPlayerRouter } from "../lib/create-app";
import { withPuzzleLinks } from "../lib/hateoas";
import { problemDetailsContent } from "../lib/problem-details";
import { rateLimit } from "../middlewares/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { requireUser } from "../middlewares/require-user";
import {
  dailyPuzzle,
  getPuzzle,
  listPuzzleAttempts,
  nextPuzzle,
  playPuzzleMoves,
  revealPuzzleSolution,
  takePuzzleHint,
} from "../puzzle/service";
import {
  idParamsSchema,
  nextPuzzleSchema,
  puzzleAttemptSchema,
  puzzleHintSchema,
  puzzleMoveResultSchema,
  puzzleRevealSchema,
  puzzleSchema,
  puzzleSubmitSchema,
} from "./schemas";
import { TAGS } from "./tags";

const base = createPlayerRouter();

// Puzzles are a per-player resource that pays out, so the same auth and metering
// the game routes carry applies here. The limit is generous: solving is a round
// trip per move, and a fast solver on a five-move line is still nowhere near it.
base.use("*", requireAuth, requireUser, rateLimit({ windowMs: 60_000, max: 120 }));

const unauthorized = problemDetailsContent("Not authenticated");
const notFound = problemDetailsContent("No such puzzle");

const next = createRoute({
  tags: [TAGS.PUZZLES],
  method: "get",
  path: "/next",
  summary: "The next puzzle to solve",
  description:
    "A puzzle near your puzzle rating that you have not been scored on, plus your current rating and solve streak. The response carries the position and the move that created the tactic — never the solution.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      nextPuzzleSchema,
      "A puzzle, or null when the catalog is exhausted",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const daily = createRoute({
  tags: [TAGS.PUZZLES],
  method: "get",
  path: "/daily",
  summary: "Today's puzzle",
  description:
    "The same puzzle for every player, for the current UTC day. Assigned on the first request of the day and stable from then on.",
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      nextPuzzleSchema,
      "Today's puzzle, or null when the catalog is empty",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const history = createRoute({
  tags: [TAGS.PUZZLES],
  method: "get",
  path: "/attempts",
  summary: "Your recent puzzle attempts",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({ attempts: z.array(puzzleAttemptSchema) }),
      "Attempts, newest first",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
  },
});

const read = createRoute({
  tags: [TAGS.PUZZLES],
  method: "get",
  path: "/{id}",
  summary: "One puzzle",
  request: { params: idParamsSchema },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(puzzleSchema, "The puzzle"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const submit = createRoute({
  tags: [TAGS.PUZZLES],
  method: "post",
  path: "/{id}/moves",
  summary: "Play a move",
  description:
    "`moves` is every move you have played on this puzzle, in order, newest last — the opponent's replies are the server's and are never sent. The request is replayed from the start each time, so retrying one you never saw the answer to is safe. The reply tells you whether the move was right and, once the puzzle is over, reveals the solution and settles the attempt: rating, XP and coins, exactly once per puzzle.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(puzzleSubmitSchema, "The moves played so far"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      puzzleMoveResultSchema,
      "What the move did",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "The puzzle is already over, or another request settled it",
    ),
    [HttpStatusCodes.UNPROCESSABLE_ENTITY]: problemDetailsContent(
      "No move was sent",
    ),
  },
});

const hint = createRoute({
  tags: [TAGS.PUZZLES],
  method: "post",
  path: "/{id}/hint",
  summary: "Ask for a hint",
  description:
    "Names the square the piece to move stands on — not where it goes. Taking a hint is recorded and halves what the solve pays and how far it moves your rating.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(puzzleRevealSchema, "The moves played so far"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(puzzleHintSchema, "The square to look at"),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
    [HttpStatusCodes.CONFLICT]: problemDetailsContent(
      "The puzzle has nothing left to hint at",
    ),
  },
});

const reveal = createRoute({
  tags: [TAGS.PUZZLES],
  method: "post",
  path: "/{id}/reveal",
  summary: "Give up and see the answer",
  description:
    "Settles the attempt as a failure — it pays nothing and lowers your puzzle rating exactly as a wrong move would — and hands back the whole line.",
  request: {
    params: idParamsSchema,
    body: jsonContentRequired(puzzleRevealSchema, "The moves played so far"),
  },
  responses: {
    [HttpStatusCodes.OK]: jsonContent(
      z.object({
        solution: z.array(z.string()),
        line: z.array(z.string()),
      }),
      "The solution",
    ),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorized,
    [HttpStatusCodes.NOT_FOUND]: notFound,
  },
});

const router = base
  .openapi(next, async (c) => {
    const result = await nextPuzzle(c.get("user"));

    return c.json(
      {
        ...result,
        puzzle: result.puzzle ? withPuzzleLinks(result.puzzle) : null,
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(daily, async (c) => {
    const result = await dailyPuzzle(c.get("user"));

    return c.json(
      {
        ...result,
        puzzle: result.puzzle ? withPuzzleLinks(result.puzzle) : null,
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(history, async (c) => {
    const { limit } = c.req.valid("query");

    const attempts = await listPuzzleAttempts({ user: c.get("user"), limit });

    return c.json({ attempts }, HttpStatusCodes.OK);
  })
  .openapi(read, async (c) => {
    const { id } = c.req.valid("param");

    const puzzle = await getPuzzle(c.get("user"), id);

    return c.json(withPuzzleLinks(puzzle), HttpStatusCodes.OK);
  })
  .openapi(submit, async (c) => {
    const { id } = c.req.valid("param");
    const { moves, hintUsed, msSpent } = c.req.valid("json");

    const result = await playPuzzleMoves({
      user: c.get("user"),
      puzzleId: id,
      moves,
      hintUsed,
      msSpent,
    });

    return c.json(result, HttpStatusCodes.OK);
  })
  .openapi(hint, async (c) => {
    const { id } = c.req.valid("param");
    const { moves } = c.req.valid("json");

    const result = await takePuzzleHint({
      user: c.get("user"),
      puzzleId: id,
      moves,
    });

    return c.json(result, HttpStatusCodes.OK);
  })
  .openapi(reveal, async (c) => {
    const { id } = c.req.valid("param");
    const { moves } = c.req.valid("json");

    const result = await revealPuzzleSolution({
      user: c.get("user"),
      puzzleId: id,
      moves,
    });

    return c.json(
      { solution: result.solution, line: result.line },
      HttpStatusCodes.OK,
    );
  });

export default router;
