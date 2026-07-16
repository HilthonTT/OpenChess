import { CORSManager, wildcardOriginRegExp } from "./cors";

/**
 * The production CORS policy: an allowlist read from `ALLOWED_ORIGINS`,
 * supporting exact origins and `*.example.com` wildcards.
 */
export function createEnvironmentBasedCORS(): CORSManager {
  // Entries are trimmed: "a.com, b.com" would otherwise never match b.com.
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
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
    credentials: true,
  });
}
