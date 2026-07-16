import { config } from "dotenv";
import { expand } from "dotenv-expand";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Resolve env files against this package, not `process.cwd()`. Both `dev:server`
 * and `test` are run from the workspace root, so a cwd-relative lookup went
 * looking for `<root>/.env.test`, found nothing, and silently loaded no file at
 * all — leaving tests to run on whatever the workspace-root `.env` happened to
 * define, real database included.
 */
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const isTest = process.env.NODE_ENV === "test";

expand(
  config({
    path: path.resolve(packageRoot, isTest ? ".env.test" : ".env"),
    // Bun injects the workspace-root `.env` before this module runs, and dotenv
    // will not overwrite an existing variable. Under test the package's own
    // `.env.test` has to win, or a developer's real credentials leak into a run.
    override: isTest,
  }),
);

const EnvSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().default(9999),
    LOG_LEVEL: z.enum([
      "fatal",
      "error",
      "warn",
      "info",
      "debug",
      "trace",
      "silent",
    ]),
    DATABASE_URL: z.url(),
    DATABASE_AUTH_TOKEN: z.string().optional(),
    // Comma-separated CORS allowlist, read by the production CORS manager.
    ALLOWED_ORIGINS: z.string().optional(),
    // The origin this API is reached on, used to build the URLs we hand to
    // Polar for post-checkout redirects. Deriving those from the request would
    // let a forged Host header point a paying customer at an attacker's site.
    // Falls back to the local dev origin; required in production.
    PUBLIC_BASE_URL: z.url().optional(),
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_PUBLISHABLE_KEY: z.string().min(1),
    CLERK_OAUTH_CLIENT_ID: z.string().min(1).optional(),
    // Unset turns Sentry off, which is what we want under `bun test` and for a
    // contributor who has no account: no DSN, no middleware, no reporting.
    SENTRY_DSN: z.url().optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    // Validated here rather than read from `process.env` at the call site, so a
    // missing one fails the boot instead of a customer's checkout request.
    POLAR_ACCESS_TOKEN: z.string().min(1),
    POLAR_PRODUCT_ID: z.string().min(1),
    POLAR_CREDITS_METER_ID: z.string().min(1),
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
  })
  .superRefine((input, ctx) => {
    if (input.NODE_ENV !== "production") {
      return;
    }

    if (!input.DATABASE_AUTH_TOKEN) {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["DATABASE_AUTH_TOKEN"],
        message: "Must be set when NODE_ENV is 'production'",
      });
    }

    // Clerk development instances share a demo signing key and let anyone sign
    // up; shipping one to production means anyone can mint a valid token.
    if (input.CLERK_SECRET_KEY.startsWith("sk_test_")) {
      ctx.addIssue({
        code: "custom",
        path: ["CLERK_SECRET_KEY"],
        message:
          "Refusing to start: this is a Clerk development key (sk_test_). Use a live key (sk_live_) in production.",
      });
    }

    if (!input.CLERK_OAUTH_CLIENT_ID) {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["CLERK_OAUTH_CLIENT_ID"],
        message:
          "Must be set when NODE_ENV is 'production' so tokens issued to other OAuth apps are rejected",
      });
    }

    // Without this there is no trustworthy origin to send a paying customer
    // back to, and the localhost fallback would ship to production.
    if (!input.PUBLIC_BASE_URL) {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["PUBLIC_BASE_URL"],
        message: "Must be set when NODE_ENV is 'production'",
      });
    }

    // The sandbox is a separate Polar environment with play money: pointing a
    // production deploy at it silently gives every purchase away for free.
    if (input.POLAR_SERVER !== "production") {
      ctx.addIssue({
        code: "custom",
        path: ["POLAR_SERVER"],
        message:
          "Refusing to start: POLAR_SERVER must be 'production' when NODE_ENV is 'production'.",
      });
    }
  });

export type env = z.infer<typeof EnvSchema>;

// eslint-disable-next-line ts/no-redeclare
const { data: env, error } = EnvSchema.safeParse(process.env);

if (error) {
  console.error("❌ Invalid env:");
  console.error(JSON.stringify(error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export default env!;
