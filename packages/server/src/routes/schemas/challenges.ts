import { z } from "@hono/zod-openapi";

import { challengeLinksSchema } from "../../lib/hateoas";

import { gameVariantSchema, timeControlKeySchema } from "./primitives";

export const challengeColorSchema = z
  .enum(["WHITE", "BLACK", "RANDOM"])
  .openapi({ example: "RANDOM" });

export const challengeSchema = z
  .object({
    id: z.string(),
    code: z.string().openapi({ example: "K7M2QP" }),
    outgoing: z.boolean(),
    challenger: z.object({
      username: z.string(),
      rating: z.number().int(),
      title: z.string().nullable(),
    }),
    challenged: z.object({ username: z.string() }).nullable(),
    color: challengeColorSchema,
    variant: gameVariantSchema,
    timeControl: timeControlKeySchema.nullable(),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"]),
    gameId: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string(),
    _links: challengeLinksSchema,
  })
  .openapi("Challenge");

export const createChallengeSchema = z
  .object({
    opponent: z.string().min(3).max(32).nullish(),
    color: challengeColorSchema.default("RANDOM"),
    variant: gameVariantSchema.default("STANDARD"),
    timeControl: timeControlKeySchema.nullish(),
  })
  .openapi("CreateChallenge");
