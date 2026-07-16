import { swaggerUI } from "@hono/swagger-ui";
import { Scalar } from "@scalar/hono-api-reference";
import type { MiddlewareHandler } from "hono";

import type { AppOpenAPI } from "./types";
import { SecurityHeaders } from "../security/headers";

import packageJSON from "../../package.json" with { type: "json" };

/**
 * The docs pages are the only HTML we serve, so the API-wide `default-src
 * 'none'` policy has to be relaxed for the bundles they pull and the inline
 * config script each emits.
 *
 * Both readers happen to ship from jsdelivr — Scalar by default, and
 * `@hono/swagger-ui` because it builds its asset URLs against
 * `cdn.jsdelivr.net/npm` — so one policy covers both. If either is ever pointed
 * at a different CDN, its host has to be added here or the page renders blank
 * with nothing in the console but a CSP violation.
 */
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

/** Swap the API's `default-src 'none'` for the docs policy, after the security
 * headers middleware has already set the strict one. */
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

  // One matcher for both readers, so a third can never be added without the
  // relaxed policy coming with it.
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
      // Both readers point at the same `/doc`, so they cannot drift apart.
      title: "OpenChess API",
      // Off so a pasted bearer token lives only in the page, not in the
      // browser's localStorage where it outlives the session.
      persistAuthorization: false,
    }),
  );
}
