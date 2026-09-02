import { z } from "@hono/zod-openapi";

import { challengeLinksSchema } from "../../lib/hateoas";

import { gameVariantSchema, timeControlKeySchema } from "./primitives";

export const challengeColorSchema = z
  .enum(["WHITE", "BLACK", "RANDOM"])
  .openapi({ example: "RANDOM" });

export const challengeSchema = z
  .object({
    id: z.string(),
    /** The short code that admits anyone to an open challenge. */
    code: z.string().openapi({ example: "K7M2QP" }),
    /** True when you are the one who sent it. */
    outgoing: z.boolean(),
    challenger: z.object({
      username: z.string(),
      rating: z.number().int(),
      title: z.string().nullable(),
    }),
    /** Null on an open challenge, until someone takes it. */
    challenged: z.object({ username: z.string() }).nullable(),
    color: challengeColorSchema,
    variant: gameVariantSchema,
    timeControl: timeControlKeySchema.nullable(),
    status: z.enum(["PENDING", "ACCEPTED", "DECLINED", "CANCELLED", "EXPIRED"]),
    /** The game it became, once accepted. */
    gameId: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string(),
    _links: challengeLinksSchema,
  })
  .openapi("Challenge");

export const createChallengeSchema = z
  .object({
    /**
     * Who to challenge. Omit for an open challenge, which anyone holding its
     * `code` can accept.
     */
    opponent: z.string().min(3).max(32).nullish(),
    color: challengeColorSchema.default("RANDOM"),
    /** Omit for an ordinary game. The array is dealt on acceptance. */
    variant: gameVariantSchema.default("STANDARD"),
    /** Omit or pass null for an untimed game. */
    timeControl: timeControlKeySchema.nullish(),
  })
  .openapi("CreateChallenge");
