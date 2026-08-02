import type { ParsedKey } from "@opentui/core";

/**
 * Whether a keypress is the one that opens the help overlay.
 *
 * `?` is shift and the slash key, and the two keyboard protocols in play
 * disagree about how to say that. A terminal read raw reports the character
 * that was produced — `?`, with no modifier flag, since the shift is already
 * baked into it. One speaking the kitty protocol reports the *key* that was
 * pressed and the modifiers separately, which is `/` with `shift` set.
 *
 * Both spellings have to be recognised, and — because `/` opens a search on
 * two screens — both have to be kept away from the unshifted slash. That is
 * why this is a predicate over the whole key rather than a comparison against
 * `key.name`: the name alone cannot tell `?` from `/`.
 */
export function isHelpKey(key: ParsedKey): boolean {
  return key.name === "?" || (key.name === "/" && key.shift);
}
