import type { User } from "@openchess/database";
import { createMiddleware } from "hono/factory";

import { getOrCreateUser } from "../lib/users";
import { touchPresence } from "../player/presence";
import type { AuthenticatedEnv } from "./require-auth";

export type PlayerEnv = {
  Variables: AuthenticatedEnv["Variables"] & {
    user: User;
  };
};

export const requireUser = createMiddleware<PlayerEnv>(async (c, next) => {
  const user = await getOrCreateUser(c.get("userId"));

  c.set("user", user);

  void touchPresence(user.id);

  await next();
});
