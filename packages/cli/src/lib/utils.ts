/**
 * Fragments that mark an error as a transport failure rather than a server
 * answer. Bun and undici phrase these several ways ("fetch failed",
 * "ConnectionRefused", "Unable to connect"), and none of them belong on
 * screen: the user's question is "is it me or the server", not which syscall
 * gave up first.
 */
const NETWORK_FAILURE_HINTS = [
  "fetch failed",
  "unable to connect",
  "connection refused",
  "connectionrefused",
  "connection closed",
  "econnrefused",
  "econnreset",
  "enotfound",
  "etimedout",
  "ehostunreach",
  "enetunreach",
  "network request failed",
  "failed to fetch",
  "dns",
];

const NETWORK_FAILURE_MESSAGE =
  "Can't reach the server. Check your connection and try again.";

const FALLBACK_MESSAGE = "Something went wrong. Try again.";

function describes(error: Error): string {
  const code = (error as { code?: unknown }).code;
  return `${error.name} ${error.message} ${typeof code === "string" ? code : ""}`.toLowerCase();
}

/**
 * The one place an unknown error becomes the string a screen or toast shows.
 * Transport failures collapse to a single friendly line — the raw messages
 * ("fetch failed") name the mechanism, never the fix — and an empty message
 * falls back to something actionable rather than a blank toast.
 */
export function errorMessage(error: unknown): string {
  // Transport errors often carry the useful signal in `cause` (fetch wraps
  // the socket error), so the whole chain is checked, not just the surface.
  for (
    let current: unknown = error;
    current instanceof Error;
    current = current.cause
  ) {
    const text = describes(current);
    if (NETWORK_FAILURE_HINTS.some((hint) => text.includes(hint))) {
      return NETWORK_FAILURE_MESSAGE;
    }
  }

  if (error instanceof Error) {
    return error.message.trim() || FALLBACK_MESSAGE;
  }

  return String(error).trim() || FALLBACK_MESSAGE;
}
