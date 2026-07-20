import env from "../env";
import { CORSManager, wildcardOriginRegExp } from "./cors";

/**
 * The production CORS policy: an allowlist read from `ALLOWED_ORIGINS`,
 * supporting exact origins and `*.example.com` wildcards.
 */
export function createEnvironmentBasedCORS(): CORSManager {
  // Entries are trimmed: "a.com, b.com" would otherwise never match b.com.
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return new CORSManager({
    origins: (origin) => {
      // Always allow same-origin requests
      if (!origin) {
        return true;
      }

      // Check whitelist
      return allowedOrigins.some((allowed) => {
        if (allowed === origin) {
          return true;
        }

        // Support wildcard subdomains
        if (allowed.startsWith("*.")) {
          return wildcardOriginRegExp(allowed).test(origin);
        }

        return false;
      });
    },
    // The API is bearer-token only. Advertising credential support would be an
    // open invitation for a future cookie to become CSRF-able from every
    // allow-listed origin.
    credentials: false,
  });
}
