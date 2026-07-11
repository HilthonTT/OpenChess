import { Scalar } from "@scalar/hono-api-reference";

import type { AppOpenAPI } from "./types";
import { SecurityHeaders } from "../security/headers";

import packageJSON from "../../package.json" with { type: "json" };

// The reference page is the one HTML route we serve, so the API-wide
// `default-src 'none'` policy has to be relaxed for Scalar's CDN bundle and the
// inline config script it emits.
const REFERENCE_CSP = SecurityHeaders.buildContentSecurityPolicy({
  "default-src": ["'none'"],
  "script-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
  "style-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
  "font-src": ["'self'", "https://cdn.jsdelivr.net", "data:"],
  "img-src": ["'self'", "https:", "data:"],
  "connect-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
});

export default function configureOpenAPI(app: AppOpenAPI) {
  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: packageJSON.version,
      title: "OpenChess API",
    },
  });

  app.use("/reference", async (c, next) => {
    await next();
    c.res.headers.set("Content-Security-Policy", REFERENCE_CSP);
  });

  app.get(
    "/reference",
    Scalar({
      url: "/doc",
      theme: "kepler",
      layout: "classic",
      defaultHttpClient: {
        targetKey: "js",
        clientKey: "fetch",
      },
    }),
  );
}
