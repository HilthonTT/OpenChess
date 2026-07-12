import createApp from "./lib/create-app";
import configureOpenAPI from "./lib/configure-open-api";
import achievements from "./routes/achievements";
import auth from "./routes/auth";
import game from "./routes/game";
import leaderboard from "./routes/leaderboard";
import me from "./routes/me";
import store from "./routes/store";

const app = createApp();
configureOpenAPI(app);

const routes = app
  .route("/auth", auth)
  .route("/games", game)
  .route("/me", me)
  .route("/titles", store)
  .route("/achievements", achievements)
  .route("/leaderboard", leaderboard);

export type AppType = typeof routes;

export default app;
