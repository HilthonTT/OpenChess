import DOMPurify, { type Config } from "isomorphic-dompurify";
import { z } from "zod";

export class XSSProtection {
  private static readonly DANGEROUS_TAGS = [
    "script",
    "iframe",
    "object",
    "embed",
    "link",
    "style",
    "form",
    "input",
    "button",
    "select",
    "textarea",
    "meta",
    "base",
  ];

  private static readonly DANGEROUS_ATTRIBUTES = [
    "onload",
    "onerror",
    "onclick",
    "onmouseover",
    "onmouseout",
    "onkeydown",
    "onkeyup",
    "onchange",
    "onfocus",
    "onblur",
    "onsubmit",
    "ondblclick",
    "onmouseenter",
    "onmouseleave",
    "oncontextmenu",
    "formaction",
    "style",
  ];

  static sanitizeHTML(
    dirty: string,
    options?: {
      allowedTags?: string[];
      allowedAttributes?: string[];
      allowDataAttributes?: boolean;
    },
  ): string {
    const config: Config = {
      ALLOWED_TAGS: options?.allowedTags || [
        "p",
        "br",
        "span",
        "div",
        "a",
        "strong",
        "em",
        "ul",
        "ol",
        "li",
      ],
      ALLOWED_ATTR: options?.allowedAttributes || ["href", "title", "class"],
      ALLOW_DATA_ATTR: options?.allowDataAttributes || false,
      FORBID_TAGS: this.DANGEROUS_TAGS,
      FORBID_ATTR: this.DANGEROUS_ATTRIBUTES,
      RETURN_TRUSTED_TYPE: false,

      // Additional security: Remove dangerous protocols
      ALLOWED_URI_REGEXP:
        /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    };

    return DOMPurify.sanitize(dirty, config);
  }

  static escapeHTML(unsafe: string): string {
    const map: { [key: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#x27;",
      "/": "&#x2F;",
    };

    return unsafe.replace(/[&<>"'/]/g, (char) => map[char] ?? "");
  }

  static sanitizeJSON(input: any): any {
    if (typeof input === "string") {
      let parsed: unknown;

      try {
        parsed = JSON.parse(input);
      } catch {
        throw new Error("Invalid JSON input");
      }

      // Parsing alone strips nothing: a raw payload can still carry
      // __proto__ keys and script-bearing strings, so sanitize the result.
      return this.deepSanitizeObject(parsed);
    }

    // Deep clone and sanitize object
    return this.deepSanitizeObject(input);
  }

  private static deepSanitizeObject(obj: any): any {
    if (obj === null || typeof obj !== "object") {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepSanitizeObject(item));
    }

    const sanitized: any = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip prototype pollution attempts
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }

      // Sanitize key
      const sanitizedKey = this.escapeHTML(key);

      // Recursively sanitize value
      if (typeof value === "string") {
        sanitized[sanitizedKey] = this.escapeHTML(value);
      } else if (typeof value === "object") {
        sanitized[sanitizedKey] = this.deepSanitizeObject(value);
      } else {
        sanitized[sanitizedKey] = value;
      }
    }

    return sanitized;
  }

  static sanitizeURL(url: string): string {
    try {
      const parsed = new URL(url);

      // Only allow safe protocols
      const safeProtocols = ["http:", "https:", "mailto:"];
      if (!safeProtocols.includes(parsed.protocol)) {
        throw new Error("Unsafe protocol");
      }

      // Reconstruct URL to remove any injected code
      return parsed.toString();
    } catch {
      // If URL parsing fails, return empty string
      return "";
    }
  }

  static createSafeTemplate(
    strings: TemplateStringsArray,
    ...values: any[]
  ): string {
    let result = "";

    for (let i = 0; i < strings.length; i++) {
      result += strings[i];

      if (i < values.length) {
        // Escape all interpolated values
        result += this.escapeHTML(String(values[i]));
      }
    }

    return result;
  }

  static createValidator<T>(schema: z.ZodSchema<T>) {
    return (data: unknown): T => {
      try {
        // Validate against schema
        const validated = schema.parse(data);

        // Additional sanitization
        return this.deepSanitizeObject(validated) as T;
      } catch (error) {
        if (error instanceof z.ZodError) {
          const errors = z.treeifyError(error);
          throw new Error(`Validation failed: ${errors.errors.join(", ")}`);
        }
        throw error;
      }
    };
  }
}
