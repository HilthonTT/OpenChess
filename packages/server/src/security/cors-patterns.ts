import env from "../env";
import { CORSManager, wildcardOriginRegExp } from "./cors";

export function createEnvironmentBasedCORS(): CORSManager {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new CORSManager({
    origins: (origin) => {
      if (!origin) {
        return true;
      }

      return allowedOrigins.some((allowed) => {
        if (allowed === origin) {
          return true;
        }

        if (allowed.startsWith("*.")) {
          return wildcardOriginRegExp(allowed).test(origin);
        }

        return false;
      });
    },
    credentials: false,
  });
}
