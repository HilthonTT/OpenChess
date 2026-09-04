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
  allowInsecureOrigins?: boolean;
}

const LOCALHOST_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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
      maxAge: 86400,
      preflightContinue: false,
      optionsSuccessStatus: HttpStatusCodes.NO_CONTENT,
      ...options,
    };

    if (Array.isArray(options.origins)) {
      for (const origin of options.origins) {
        this.allowedOrigins.add(origin);
      }
    }
  }

  middleware(): MiddlewareHandler {
    return async (c, next) => {
      const origin = c.req.header("Origin");

      if (origin) {
        if (this.isOriginAllowed(origin)) {
          this.setHeaders(c, origin);
        } else {
          c.var.logger?.warn(
            { origin: origin.slice(0, 256) },
            "CORS blocked origin",
          );
        }
      }

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

    if (this.allowedOrigins.has(origin)) {
      return true;
    }

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

  static createDynamicOriginValidator(config: {
    allowedDomains: string[];
    allowLocalhost?: boolean;
    allowSubdomains?: boolean;
  }): (origin: string) => boolean {
    return (origin: string) => {
      try {
        const url = new URL(origin);
        const isLocalhost = LOCALHOST_HOSTNAMES.has(url.hostname);

        const isSecure =
          url.protocol === "https:" ||
          (url.protocol === "http:" && isLocalhost && !!config.allowLocalhost);

        if (!isSecure) {
          return false;
        }

        if (config.allowLocalhost && isLocalhost) {
          return true;
        }

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

export const developmentCORS = new CORSManager({
  origins: CORSManager.createDynamicOriginValidator({
    allowedDomains: ["localhost", "127.0.0.1"],
    allowLocalhost: true,
    allowSubdomains: false,
  }),
  credentials: true,
  optionsSuccessStatus: HttpStatusCodes.NO_CONTENT,
});
