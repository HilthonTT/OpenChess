import { pinoLogger as logger } from "hono-pino";
import pino from "pino";
import pretty from "pino-pretty";

import env from "../env";

export const baseLogger = pino(
  {
    level: env.LOG_LEVEL || "info",
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      censor: "[redacted]",
    },
  },
  env.NODE_ENV === "production" ? undefined : pretty(),
);

export function pinoLogger() {
  return logger({
    pino: baseLogger,
  });
}
