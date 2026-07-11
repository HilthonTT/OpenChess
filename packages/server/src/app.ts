import createApp from "./lib/create-app";
import configureOpenAPI from "./lib/configure-open-api";
import auth from "./routes/auth";

const app = createApp();
configureOpenAPI(app);

const routes = app.route("/auth", auth);

export type AppType = typeof routes;

export default app;
