import { config } from "dotenv";
import { expand } from "dotenv-expand";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const isTest = process.env.NODE_ENV === "test";

expand(
  config({
    path: path.resolve(packageRoot, isTest ? ".env.test" : ".env"),
    override: isTest,
  }),
);

const blankAsUndefined = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema);

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
    TRUST_PROXY: blankAsUndefined(z.stringbool().default(false)),
    ALLOWED_ORIGINS: blankAsUndefined(z.string().optional()),
    PUBLIC_BASE_URL: blankAsUndefined(z.url().optional()),
    CLERK_SECRET_KEY: z.string().min(1),
    CLERK_PUBLISHABLE_KEY: z.string().min(1),
    CLERK_OAUTH_CLIENT_ID: blankAsUndefined(z.string().min(1).optional()),
    SENTRY_DSN: blankAsUndefined(z.url().optional()),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
    POLAR_ACCESS_TOKEN: z.string().min(1),
    POLAR_PRODUCT_ID: z.string().min(1),
    POLAR_SERVER: z.enum(["sandbox", "production"]).default("sandbox"),
    INNGEST_SIGNING_KEY: blankAsUndefined(z.string().min(1).optional()),
    INNGEST_DEV: blankAsUndefined(z.string().optional()),
    UPSTASH_REDIS_REST_URL: blankAsUndefined(z.url().optional()),
    UPSTASH_REDIS_REST_TOKEN: blankAsUndefined(z.string().min(1).optional()),
  })
  .superRefine((input, ctx) => {
    if (!!input.UPSTASH_REDIS_REST_URL !== !!input.UPSTASH_REDIS_REST_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: [
          input.UPSTASH_REDIS_REST_URL
            ? "UPSTASH_REDIS_REST_TOKEN"
            : "UPSTASH_REDIS_REST_URL",
        ],
        message:
          "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set together",
      });
    }

    if (
      input.CLERK_SECRET_KEY.startsWith("sk_live_") &&
      !input.CLERK_OAUTH_CLIENT_ID
    ) {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["CLERK_OAUTH_CLIENT_ID"],
        message:
          "Must be set when using a live Clerk key (sk_live_) so tokens issued to other OAuth apps are rejected",
      });
    }

    if (input.NODE_ENV !== "production") {
      return;
    }

    if (input.INNGEST_DEV) {
      ctx.addIssue({
        code: "custom",
        path: ["INNGEST_DEV"],
        message:
          "Refusing to start: INNGEST_DEV disables Inngest signature verification and must not be set in production.",
      });
    }

    if (!input.INNGEST_SIGNING_KEY) {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["INNGEST_SIGNING_KEY"],
        message:
          "Must be set when NODE_ENV is 'production' so /api/inngest requests are signature-verified",
      });
    }

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

    if (!input.PUBLIC_BASE_URL) {
      ctx.addIssue({
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["PUBLIC_BASE_URL"],
        message: "Must be set when NODE_ENV is 'production'",
      });
    }

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

const { data: env, error } = EnvSchema.safeParse(process.env);

if (error) {
  console.error("❌ Invalid env:");
  console.error(JSON.stringify(error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export default env!;
