import type { Context, MiddlewareHandler } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import * as HttpStatusCodes from "stoker/http-status-codes";

interface CORSOptions {
  origins: string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: StatusCode;
  /**
   * Allow plaintext http:// origins to match wildcard entries. Off by default:
   * a credentialed CORS grant to an http:// origin is readable by any MITM.
   */
  allowInsecureOrigins?: boolean;
}

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Escape every regex metacharacter. `String.replace` with a string pattern only
 * replaces the FIRST match, so escaping dots by hand leaves later dots live as
 * "any character" wildcards.
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build the `*.example.com` matcher used by both the manager and the patterns. */
export function wildcardOriginRegExp(
  wildcard: string,
  allowInsecureOrigins = false,
): RegExp {
  const domain = escapeRegExp(wildcard.slice(2));
  const scheme = allowInsecureOrigins ? "https?" : "https";

  return new RegExp(`^${scheme}://[^.]+\\.${domain}$`);
}

export class CORSManager {
  private options: CORSOptions;
  private allowedOrigins: Set<string> = new Set();

  constructor(options: CORSOptions) {
    this.options = {
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      exposedHeaders: ["X-Total-Count", "X-Page-Number"],
      credentials: true,
      maxAge: 86400, // 24 hours
      preflightContinue: false,
      optionsSuccessStatus: HttpStatusCodes.NO_CONTENT,
      ...options,
    };

    if (Array.isArray(options.origins)) {
      options.origins.forEach((origin) => this.allowedOrigins.add(origin));
    }
  }

  middleware(): MiddlewareHandler {
    return async (c, next) => {
      const origin = c.req.header("Origin");

      if (origin) {
        if (this.isOriginAllowed(origin)) {
          this.setHeaders(c, origin);
        } else {
          // Through the request logger, not console: the origin header is
          // attacker-supplied, so it is truncated and kept structured rather
          // than handed a free line of raw log output per request.
          c.var.logger?.warn(
            { origin: origin.slice(0, 256) },
            "CORS blocked origin",
          );
        }
      }

      // Handle preflight requests
      if (c.req.method === "OPTIONS" && !this.options.preflightContinue) {
        return c.body(
          null,
          this.options.optionsSuccessStatus || HttpStatusCodes.NO_CONTENT,
        );
      }

      await next();
    };
  }

  private isOriginAllowed(origin: string): boolean {
    if (typeof this.options.origins === "function") {
      return this.options.origins(origin);
    }

    // Check exact match
    if (this.allowedOrigins.has(origin)) {
      return true;
    }

    // Check wildcard subdomain matching
    for (const allowed of this.allowedOrigins) {
      if (allowed.startsWith("*.")) {
        const regex = wildcardOriginRegExp(
          allowed,
          this.options.allowInsecureOrigins,
        );
        if (regex.test(origin)) {
          return true;
        }
      }
    }

    return false;
  }

  private setHeaders(c: Context, origin: string): void {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Vary", "Origin", { append: true });

    if (this.options.credentials) {
      c.header("Access-Control-Allow-Credentials", "true");
    }

    if (this.options.methods) {
      c.header("Access-Control-Allow-Methods", this.options.methods.join(", "));
    }

    if (this.options.allowedHeaders) {
      c.header(
        "Access-Control-Allow-Headers",
        this.options.allowedHeaders.join(", "),
      );
    }

    if (this.options.exposedHeaders) {
      c.header(
        "Access-Control-Expose-Headers",
        this.options.exposedHeaders.join(", "),
      );
    }

    if (this.options.maxAge) {
      c.header("Access-Control-Max-Age", this.options.maxAge.toString());
    }
  }

  // Dynamic origin validation
  static createDynamicOriginValidator(config: {
    allowedDomains: string[];
    allowLocalhost?: boolean;
    allowSubdomains?: boolean;
  }): (origin: string) => boolean {
    return (origin: string) => {
      try {
        const url = new URL(origin);
        const isLocalhost = LOCALHOST_HOSTNAMES.has(url.hostname);

        // Require TLS. Plaintext is tolerated only for localhost in dev:
        // credentials granted to an http:// origin are readable by any MITM,
        // and without this check schemes like ftp:// pass too.
        const isSecure =
          url.protocol === "https:" ||
          (url.protocol === "http:" && isLocalhost && !!config.allowLocalhost);

        if (!isSecure) {
          return false;
        }

        // Allow localhost in development
        if (config.allowLocalhost && isLocalhost) {
          return true;
        }

        // Check allowed domains
        for (const domain of config.allowedDomains) {
          if (config.allowSubdomains) {
            if (
              url.hostname === domain ||
              url.hostname.endsWith(`.${domain}`)
            ) {
              return true;
            }
          } else {
            if (url.hostname === domain) {
              return true;
            }
          }
        }

        return false;
      } catch {
        return false;
      }
    };
  }
}

// Development CORS configuration
export const developmentCORS = new CORSManager({
  origins: CORSManager.createDynamicOriginValidator({
    allowedDomains: ["localhost", "127.0.0.1"],
    allowLocalhost: true,
    allowSubdomains: false,
  }),
  credentials: true,
  optionsSuccessStatus: HttpStatusCodes.NO_CONTENT,
});
