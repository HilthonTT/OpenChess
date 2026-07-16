import createApp from "./lib/create-app";
import configureOpenAPI from "./lib/configure-open-api";
import achievements from "./routes/achievements";
import auth from "./routes/auth";
import game from "./routes/game";
import leaderboard from "./routes/leaderboard";
import me from "./routes/me";
import store from "./routes/store";
import billing from "./routes/billing";
import { serve } from "inngest/hono";
import { inngest } from "./inngest";
import { functions } from "./inngest/functions";

const app = createApp();
configureOpenAPI(app);

const routes = app
  .route("/auth", auth)
  .route("/games", game)
  .route("/me", me)
  .route("/titles", store)
  .route("/achievements", achievements)
  .route("/leaderboard", leaderboard)
  .route("/billing", billing);

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({
    client: inngest,
    functions,
  }),
);

export type AppType = typeof routes;

export default app;
