import { CORSManager, wildcardOriginRegExp } from "./cors";

export class CORSSecurityPatterns {
  static createEnvironmentBasedCORS(): CORSManager {
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

  static createTokenBasedCORS(
    validateToken: (token: string) => boolean,
  ): CORSManager {
    return new CORSManager({
      origins: (origin) => {
        const token = this.extractTokenFromOrigin(origin);

        if (!token) {
          return false;
        }

        // Validate token
        return validateToken(token);
      },
      credentials: false, // Don't use cookies with token-based auth
    });
  }

  static createTimeBasedCORS(
    allowedOrigins: string[],
    restrictedHours?: {
      start: number;
      end: number;
    },
  ): CORSManager {
    return new CORSManager({
      origins: (origin) => {
        if (!allowedOrigins.includes(origin)) {
          return false;
        }

        if (restrictedHours) {
          const hour = new Date().getHours();
          if (hour >= restrictedHours.start && hour < restrictedHours.end) {
            console.warn(
              `CORS: Access restricted during hours ${restrictedHours.start}-${restrictedHours.end}`,
            );
            return false;
          }
        }

        return true;
      },
    });
  }

  static createRateLimitedCORS(
    allowedOrigins: string[],
    rateLimit: { windowMs: number; max: number },
  ): CORSManager {
    const requestCounts = new Map<
      string,
      { count: number; resetTime: number }
    >();

    return new CORSManager({
      origins: (origin) => {
        if (!allowedOrigins.includes(origin)) {
          return false;
        }

        const now = Date.now();
        const record = requestCounts.get(origin) || {
          count: 0,
          resetTime: now + rateLimit.windowMs,
        };

        if (now > record.resetTime) {
          // Reset window
          record.count = 0;
          record.resetTime = now + rateLimit.windowMs;
        }

        record.count++;
        requestCounts.set(origin, record);

        if (record.count > rateLimit.max) {
          console.warn(`CORS: Rate limit exceeded for origin ${origin}`);
          return false;
        }

        return true;
      },
    });
  }

  private static extractTokenFromOrigin(origin: string): string | null {
    // Example: Extract token from subdomain
    const match = origin.match(/^https?:\/\/([^.]+)\.api\.example\.com$/);
    if (match) {
      const token = match[1];
      return token ? token : null;
    }

    return null;
  }
}
