import { z } from "@hono/zod-openapi";

export const challengeCodeParamsSchema = z.object({
  code: z
    .string()
    .min(4)
    .max(12)
    .openapi({ param: { name: "code", in: "path" }, example: "K7M2QP" }),
});

/** A `{username}` path segment, matched case-insensitively by the service. */
export const usernameParamsSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .openapi({ param: { name: "username", in: "path" }, example: "magnus" }),
});

/** A cuid in the `{id}` path segment. Shared by every by-id route. */
export const idParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .openapi({
      param: { name: "id", in: "path" },
      example: "clx0h2k9r0000abcd1234efgh",
    }),
});
