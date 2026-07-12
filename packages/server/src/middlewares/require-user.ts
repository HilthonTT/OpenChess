import type { User } from "@openchess/database";
import { createMiddleware } from "hono/factory";

import { getOrCreateUser } from "../lib/users";
import type { AuthenticatedEnv } from "./require-auth";

/**
 * Routes behind `requireUser` can read the local player row off the context.
 *
 * `requireAuth` sets `userId` to the *Clerk* id. Almost nothing in the schema
 * wants that: `Game.whitePlayerId`, `CoinTransaction.userId` and friends all
 * reference `User.id`. Handlers should reach for `c.get("user").id`, and this
 * middleware is what makes that safe to do.
 */
export type PlayerEnv = {
  Variables: AuthenticatedEnv["Variables"] & {
    user: User;
  };
};

/** Must run after `requireAuth`, which is what puts the Clerk id on the context. */
export const requireUser = createMiddleware<PlayerEnv>(async (c, next) => {
  const user = await getOrCreateUser(c.get("userId"));

  c.set("user", user);

  await next();
});
