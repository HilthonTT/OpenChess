import type { ParsedKey } from "@opentui/core";

export function isHelpKey(key: ParsedKey): boolean {
  return key.name === "?" || (key.name === "/" && key.shift);
}
