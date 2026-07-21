import * as HttpStatusCodes from "stoker/http-status-codes";
import { createRoute } from "@hono/zod-openapi";
import { TAGS } from "./tags";
import { healthStatusSchema } from "./schemas";
import { createRouter } from "../lib/create-app";
import { db } from "@openchess/database/client";
import { redis } from "../lib/upstash";

type DatabaseStatus = "connected" | "disconnected";
type RedisStatus = "connected" | "disconnected" | "disabled";

const HEALTH_CHECK_TIMEOUT_MS = 5_000;

const base = createRouter();

const healthRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "getHealth",
  tags: [TAGS.HEALTH],
  summary: "Health check",
  description: "Lightweight health check for HTTP server",
  responses: {
    200: {
      description: "Service is healthy",
      content: { "application/json": { schema: healthStatusSchema } },
    },
  },
});

const healthDeepRoute = createRoute({
  method: "get",
  path: "/deep",
  operationId: "getHealthDeep",
  tags: ["Health"],
  summary: "Deep health check",
  description: "Comprehensive health check including dependencies",
  responses: {
    200: {
      description: "Service and dependencies are healthy",
      content: { "application/json": { schema: healthStatusSchema } },
    },
    503: {
      description: "Service or dependencies are unhealthy",
      content: { "application/json": { schema: healthStatusSchema } },
    },
  },
});

async function checkDatabase(): Promise<{ status: DatabaseStatus }> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), HEALTH_CHECK_TIMEOUT_MS),
    );

    await Promise.race([db.$queryRaw`SELECT 1`, timeoutPromise]);

    return { status: "connected" };
  } catch (error) {
    console.error("Database health check failed:", error);
    return { status: "disconnected" };
  }
}

async function checkRedis(): Promise<{ status: RedisStatus }> {
  if (!redis) {
    return { status: "disabled" }; // cache intentionally off, not a failure
  }

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Timeout")), HEALTH_CHECK_TIMEOUT_MS),
    );

    const pong = await Promise.race([redis.ping(), timeoutPromise]);

    return pong === "PONG"
      ? { status: "connected" }
      : { status: "disconnected" };
  } catch (error) {
    console.error("Redis health check failed:", error);
    return { status: "disconnected" };
  }
}

const router = base
  .openapi(healthRoute, async (c) => {
    return c.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
      HttpStatusCodes.OK,
    );
  })
  .openapi(healthDeepRoute, async (c) => {
    const [dbCheck, redisCheck] = await Promise.allSettled([
      checkDatabase(),
      checkRedis(),
    ]);

    const dbStatus =
      dbCheck.status === "fulfilled" ? dbCheck.value.status : "disconnected";
    const redisStatus =
      redisCheck.status === "fulfilled"
        ? redisCheck.value.status
        : "disconnected";

    // The database is required. Redis is an optimization: "disabled" (not
    // configured) is fine, only an actual failure ("disconnected") degrades us.
    const dbHealthy = dbStatus === "connected";
    const redisHealthy = redisStatus !== "disconnected";

    const status = dbHealthy
      ? redisHealthy
        ? "healthy"
        : "degraded"
      : "unhealthy";

    return c.json(
      {
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        dependencies: {
          database: dbStatus,
          redis: redisStatus,
        },
      },
      dbHealthy ? HttpStatusCodes.OK : HttpStatusCodes.SERVICE_UNAVAILABLE,
    );
  });

export default router;
