import { pinoLogger as logger } from "hono-pino";
import pino from "pino";
import pretty from "pino-pretty";

import env from "../env";

export function pinoLogger() {
  return logger({
    pino: pino(
      {
        level: env.LOG_LEVEL || "info",
        // hono-pino's default request bindings include every request header,
        // and `Authorization` carries the user's OAuth access token — logging
        // it hands a replayable credential to anyone who can read the logs.
        // Header keys arrive lowercased, so these paths match as written.
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie"],
          censor: "[redacted]",
        },
      },
      env.NODE_ENV === "production" ? undefined : pretty(),
    ),
  });
}
