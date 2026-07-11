import type { MiddlewareHandler } from "hono";

export interface SecurityHeadersOptions {
  noCacheHeaders?: boolean;
  additionalHeaders?: Record<string, string>;
  /** Override the CSP directives, or pass false to omit the header entirely. */
  contentSecurityPolicy?: Record<string, string[]> | false;
  /** Advertise Report-To/NEL endpoints. Off unless those routes actually exist. */
  reportingEndpoints?: boolean;
}

/**
 * Locked down for a JSON API: nothing should ever be loaded or framed. Routes
 * that serve HTML (the API reference) override this with their own policy.
 */
const DEFAULT_CSP_DIRECTIVES: Record<string, string[]> = {
  "default-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'none'"],
  "form-action": ["'none'"],
};

export class SecurityHeaders {
  static buildContentSecurityPolicy(
    directives: Record<string, string[]> = DEFAULT_CSP_DIRECTIVES,
  ): string {
    return Object.entries(directives)
      .map(([directive, values]) => `${directive} ${values.join(" ")}`)
      .join("; ");
  }

  static getProductionHeaders(): Record<string, string> {
    return {
      // Strict Transport Security
      "Strict-Transport-Security":
        "max-age=31536000; includeSubDomains; preload",

      // Prevent MIME type sniffing
      "X-Content-Type-Options": "nosniff",

      // Disables the legacy XSS auditor: its heuristics were themselves
      // exploitable, and CSP is the real control. 0 is the recommended value.
      "X-XSS-Protection": "0",

      // Clickjacking protection
      "X-Frame-Options": "DENY",

      // Referrer Policy
      "Referrer-Policy": "strict-origin-when-cross-origin",

      // Permissions Policy (formerly Feature Policy)
      "Permissions-Policy": [
        "accelerometer=()",
        "autoplay=()",
        "camera=()",
        "encrypted-media=()",
        "fullscreen=(self)",
        "geolocation=(self)",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "midi=()",
        "payment=()",
        "picture-in-picture=()",
        "sync-xhr=()",
        "usb=()",
        "interest-cohort=()", // Opt out of FLoC
      ].join(", "),

      // Cross-Origin Policies
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",

      // Cache Control for sensitive pages
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",

      // Additional security headers
      "X-DNS-Prefetch-Control": "off",
      "X-Download-Options": "noopen",
      "X-Permitted-Cross-Domain-Policies": "none",
    };
  }

  static getReportingEndpoints(): Record<string, string> {
    return {
      "Report-To": JSON.stringify([
        {
          group: "csp-endpoint",
          max_age: 86400,
          endpoints: [{ url: "/api/security/csp-report" }],
        },
        {
          group: "network-errors",
          max_age: 86400,
          endpoints: [{ url: "/api/security/network-error" }],
        },
        {
          group: "deprecation",
          max_age: 86400,
          endpoints: [{ url: "/api/security/deprecation-report" }],
        },
      ]),

      NEL: JSON.stringify({
        report_to: "network-errors",
        max_age: 86400,
        include_subdomains: true,
      }),
    };
  }

  static applyToResponse(
    res: Response,
    options?: SecurityHeadersOptions,
  ): void {
    const headers = this.getProductionHeaders();

    // Apply security headers
    for (const [name, value] of Object.entries(headers)) {
      // Skip cache headers if requested
      if (
        options?.noCacheHeaders &&
        ["Cache-Control", "Pragma", "Expires"].includes(name)
      ) {
        continue;
      }
      res.headers.set(name, value);
    }

    // Content Security Policy. A route that already set its own policy (the
    // API reference page) keeps it.
    if (
      options?.contentSecurityPolicy !== false &&
      !res.headers.has("Content-Security-Policy")
    ) {
      res.headers.set(
        "Content-Security-Policy",
        this.buildContentSecurityPolicy(
          options?.contentSecurityPolicy ?? DEFAULT_CSP_DIRECTIVES,
        ),
      );
    }

    // Apply reporting headers
    if (options?.reportingEndpoints) {
      for (const [name, value] of Object.entries(this.getReportingEndpoints())) {
        res.headers.set(name, value);
      }
    }

    // Apply additional headers
    if (options?.additionalHeaders) {
      for (const [name, value] of Object.entries(options.additionalHeaders)) {
        res.headers.set(name, value);
      }
    }

    // Remove potentially dangerous headers
    res.headers.delete("X-Powered-By");
    res.headers.delete("Server");
  }
}

export function securityHeadersMiddleware(
  options?: SecurityHeadersOptions,
): MiddlewareHandler {
  return async (c, next) => {
    await next();
    SecurityHeaders.applyToResponse(c.res, options);
  };
}
