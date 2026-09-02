import { z } from "@hono/zod-openapi";

export const healthStatusSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]),
    timestamp: z.string(),
    uptime: z.number(),
    dependencies: z
      .object({
        database: z.enum(["connected", "disconnected"]),
        redis: z.enum(["connected", "disconnected", "disabled"]),
      })
      .optional(),
  })
  .openapi("HealthStatus");
