import createApp from "./lib/create-app";
import configureOpenAPI from "./lib/configure-open-api";
import achievements from "./routes/achievements";
import auth from "./routes/auth";
import challenges from "./routes/challenges";
import friends from "./routes/friends";
import game from "./routes/game";
import players from "./routes/players";
import puzzles from "./routes/puzzles";
import repertoire from "./routes/repertoire";
import leaderboard from "./routes/leaderboard";
import me from "./routes/me";
import store from "./routes/store";
import billing from "./routes/billing";
import health from "./routes/health";
import root from "./routes/root";
import { createRouter } from "./lib/create-app";
import { serve } from "inngest/hono";
import { inngest } from "./inngest";
import { functions } from "./inngest/functions";

const app = createApp();
configureOpenAPI(app);

const api = createRouter()
  .route("/", root)
  .route("/auth", auth)
  .route("/games", game)
  .route("/puzzles", puzzles)
  .route("/repertoire", repertoire)
  .route("/challenges", challenges)
  .route("/friends", friends)
  .route("/players", players)
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

export type AppType = typeof api;

export default app;
