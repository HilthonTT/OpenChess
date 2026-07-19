import { Redis } from "@upstash/redis";

import env from "../env";

/**
 * The Upstash Redis client, or null when the cache is off.
 *
 * Null when the credential pair is not configured — the cache is an
 * optimization, and everything built on it must degrade to the database.
 *
 * Also forced off under test: Bun injects the workspace-root `.env` into every
 * process, and `.env.test` only overrides the keys it defines, so without this
 * guard `bun test` would quietly talk to the real Redis.
 */
export const redis: Redis | null =
  env.NODE_ENV !== "test" &&
  env.UPSTASH_REDIS_REST_URL &&
  env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: env.UPSTASH_REDIS_REST_URL,
        token: env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;
