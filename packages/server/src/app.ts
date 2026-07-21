import createApp from "./lib/create-app";
import configureOpenAPI from "./lib/configure-open-api";
import achievements from "./routes/achievements";
import auth from "./routes/auth";
import game from "./routes/game";
import leaderboard from "./routes/leaderboard";
import me from "./routes/me";
import store from "./routes/store";
import billing from "./routes/billing";
import health from "./routes/health";
import { createRouter } from "./lib/create-app";
import { serve } from "inngest/hono";
import { inngest } from "./inngest";
import { functions } from "./inngest/functions";

const app = createApp();
configureOpenAPI(app);

const api = createRouter()
  .route("/auth", auth)
  .route("/games", game)
  .route("/me", me)
  .route("/titles", store)
  .route("/achievements", achievements)
  .route("/leaderboard", leaderboard)
  .route("/billing", billing)
  .route("/health", health);

app.route("/api", api);

app.on(
  ["GET", "PUT", "POST"],
  "/api/inngest",
  serve({
    client: inngest,
    functions,
  }),
);

// The CLI's `hc` client already points its base URL at `/api`, so the client
// type must be the un-prefixed router — using the wrapper app here would force
// every call site through an extra `.api` and double the prefix at runtime.
export type AppType = typeof api;

export default app;
