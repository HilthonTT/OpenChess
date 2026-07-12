import { Hono } from "hono";
import { type AuthenticatedEnv } from "../middlewares/require-auth";

const app = new Hono<AuthenticatedEnv>().get("/game", async (c) => {
  const userId = c.get("userId");
});
