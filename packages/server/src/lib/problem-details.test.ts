import { describe, expect, test } from "bun:test";
import { createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import * as HttpStatusCodes from "stoker/http-status-codes";

import createApp, { createRouter } from "./create-app";
import {
  PROBLEM_JSON_MEDIA_TYPE,
  ProblemType,
  phraseForStatus,
  problemFromError,
} from "./problem-details";
import type { ProblemDetails } from "./problem-details";

/** An app exercising each route into an error path. */
function appUnderTest() {
  const app = createApp();

  app.get("/boom", () => {
    throw new Error("database exploded: table users_secret");
  });

  app.get("/teapot", () => {
    throw new HTTPException(HttpStatusCodes.IM_A_TEAPOT, {
      message: "I decline to brew",
    });
  });

  app.get("/bare-forbidden", () => {
    throw new HTTPException(HttpStatusCodes.FORBIDDEN);
  });

  app.get("/custom-response", () => {
    throw new HTTPException(HttpStatusCodes.UNAUTHORIZED, {
      res: new Response("go away", { status: HttpStatusCodes.UNAUTHORIZED }),
    });
  });

  const router = createRouter().openapi(
    createRoute({
      method: "post",
      path: "/players",
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({ name: z.string().min(3), rating: z.number() }),
            },
          },
        },
      },
      responses: {
        [HttpStatusCodes.OK]: { description: "ok" },
      },
    }),
    (c) => c.json({ ok: true }),
  );

  return app.route("/", router);
}

async function problemFrom(response: Response): Promise<ProblemDetails> {
  expect(response.headers.get("content-type")).toContain(
    PROBLEM_JSON_MEDIA_TYPE,
  );
  return (await response.json()) as ProblemDetails;
}

describe("phraseForStatus", () => {
  test("maps status codes to their reason phrase", () => {
    expect(phraseForStatus(HttpStatusCodes.NOT_FOUND)).toBe("Not Found");
    expect(phraseForStatus(HttpStatusCodes.INTERNAL_SERVER_ERROR)).toBe(
      "Internal Server Error",
    );
    expect(phraseForStatus(HttpStatusCodes.UNPROCESSABLE_ENTITY)).toBe(
      "Unprocessable Entity",
    );
  });

  test("falls back for a status it doesn't know", () => {
    expect(phraseForStatus(599)).toBe("Error");
  });
});

describe("problemFromError", () => {
  test("an unexpected error withholds its message in production", () => {
    const error = new Error("connection string: postgres://user:hunter2@db");
    const problem = problemFromError(error, { debug: false });

    expect(problem.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
    expect(problem.detail).toBe("Internal Server Error");
    expect(problem.stack).toBeUndefined();
    expect(JSON.stringify(problem)).not.toContain("hunter2");
  });

  test("an unexpected error explains itself in development", () => {
    const problem = problemFromError(new Error("kaboom"), { debug: true });

    expect(problem.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
    expect(problem.detail).toBe("kaboom");
    expect(problem.stack).toBeDefined();
  });

  test("an HTTPException keeps its status and message in either mode", () => {
    const error = new HTTPException(HttpStatusCodes.CONFLICT, {
      message: "Game already started",
    });

    for (const debug of [true, false]) {
      const problem = problemFromError(error, { debug });
      expect(problem.status).toBe(HttpStatusCodes.CONFLICT);
      expect(problem.detail).toBe("Game already started");
    }
  });

  test("an HTTPException without a message falls back to the reason phrase", () => {
    const problem = problemFromError(
      new HTTPException(HttpStatusCodes.FORBIDDEN),
      { debug: false },
    );
    expect(problem.detail).toBe("Forbidden");
  });
});

describe("error responses", () => {
  test("an unmatched route is a 404 problem", async () => {
    const response = await appUnderTest().request("/nope");
    expect(response.status).toBe(HttpStatusCodes.NOT_FOUND);

    const problem = await problemFrom(response);
    expect(problem).toMatchObject({
      type: ProblemType.BLANK,
      title: "Not Found",
      status: HttpStatusCodes.NOT_FOUND,
      detail: "No route matched GET /nope",
      instance: "/nope",
    });
    expect(problem.requestId).toBeString();
  });

  test("a thrown HTTPException becomes a problem with its own status", async () => {
    const response = await appUnderTest().request("/teapot");
    expect(response.status).toBe(HttpStatusCodes.IM_A_TEAPOT);

    expect(await problemFrom(response)).toMatchObject({
      title: "I'm a teapot",
      status: HttpStatusCodes.IM_A_TEAPOT,
      detail: "I decline to brew",
      instance: "/teapot",
    });
  });

  test("an HTTPException with no message uses the reason phrase as detail", async () => {
    const response = await appUnderTest().request("/bare-forbidden");
    expect(response.status).toBe(HttpStatusCodes.FORBIDDEN);
    expect(await problemFrom(response)).toMatchObject({
      title: "Forbidden",
      detail: "Forbidden",
    });
  });

  test("an unexpected throw becomes a 500 problem", async () => {
    const response = await appUnderTest().request("/boom");
    expect(response.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);

    const problem = await problemFrom(response);
    expect(problem.title).toBe("Internal Server Error");
    expect(problem.status).toBe(HttpStatusCodes.INTERNAL_SERVER_ERROR);
    expect(problem.instance).toBe("/boom");
  });

  test("an HTTPException carrying its own response is passed through untouched", async () => {
    const response = await appUnderTest().request("/custom-response");
    expect(response.status).toBe(HttpStatusCodes.UNAUTHORIZED);
    expect(await response.text()).toBe("go away");
  });

  test("a validation failure lists every offending field", async () => {
    const response = await appUnderTest().request("/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ab" }),
    });
    expect(response.status).toBe(HttpStatusCodes.UNPROCESSABLE_ENTITY);

    const problem = await problemFrom(response);
    expect(problem).toMatchObject({
      type: ProblemType.VALIDATION_ERROR,
      title: "Validation Failed",
      status: HttpStatusCodes.UNPROCESSABLE_ENTITY,
      instance: "/players",
    });

    const paths = problem.errors?.map((issue) => issue.path).sort();
    expect(paths).toEqual(["name", "rating"]);
    expect(problem.errors?.every((issue) => Boolean(issue.message))).toBe(true);
  });

  test("a successful request is untouched by any of this", async () => {
    const response = await appUnderTest().request("/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "magnus", rating: 2839 }),
    });

    expect(response.status).toBe(HttpStatusCodes.OK);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-type")).not.toContain("problem");
  });
});
