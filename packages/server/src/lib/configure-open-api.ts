import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";
import type { MiddlewareHandler } from "hono";

import type { AppOpenAPI } from "./types";
import { SecurityHeaders } from "../security/headers";

import packageJSON from "../../package.json" with { type: "json" };

const DOCS_CSP = SecurityHeaders.buildContentSecurityPolicy({
  "default-src": ["'none'"],
  "script-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
  "style-src": ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
  "font-src": ["'self'", "https://cdn.jsdelivr.net", "data:"],
  "img-src": ["'self'", "https:", "data:"],
  "connect-src": ["'self'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
});

const relaxCSP: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("Content-Security-Policy", DOCS_CSP);
};

export default function configureOpenAPI(app: AppOpenAPI) {
  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: packageJSON.version,
      title: "OpenChess API",
    },
  });

  app.use("/reference", relaxCSP);
  app.use("/swagger", relaxCSP);

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

  app.get(
    "/swagger",
    swaggerUI({
      url: "/doc",
      title: "OpenChess API",
      persistAuthorization: false,
    }),
  );
}
