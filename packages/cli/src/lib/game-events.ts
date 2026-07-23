import { clearAuth, getAuth } from "./auth";
import { refreshAccessToken } from "./oauth";
import type { ServerGame } from "./games";

/**
 * The live feed for an online game, over Server-Sent Events.
 *
 * This replaces polling `GET /games/{id}` every two seconds. The saving is not
 * only the request rate: every one of those polls carried a token verification
 * and a full game load, and the opponent's move was on average a second old by
 * the time it showed up. One connection, pushed to, is both cheaper and faster.
 *
 * Written against `fetch` rather than `EventSource`, which Bun does have, for
 * one reason: `EventSource` cannot send an `Authorization` header, and the API
 * takes a bearer token. That means parsing the wire format here, which is small
 * and stable enough to be worth it.
 *
 * A dropped connection is reconnected with backoff, and every reconnect is
 * handed the current state immediately by the server — so a reconnect is also
 * the resync, and no separate catch-up fetch is ever needed.
 */

const API_URL = process.env.API_URL ?? "http://localhost:3000/api";

/** Backoff between reconnects: 1s doubling to a 10s ceiling. */
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 10_000;

export type GameStreamHandlers = {
  /** The authoritative game state, sent on connect and on every change. */
  onState: (game: ServerGame) => void;
};

type ParsedEvent = { event: string; data: string };

/**
 * Split one SSE frame into its event name and joined data lines. Returns null
 * for a frame carrying no data at all — which is what a `: keepalive` comment
 * is, and the reason idle connections do not surface as events.
 */
function parseFrame(raw: string): ParsedEvent | null {
  let event = "message";
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // One optional leading space after the colon is part of the framing, not
    // the value — stripping more would corrupt indented JSON.
    const value =
      colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }

  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

async function consume(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: ParsedEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }

      // Normalized so a proxy that rewrites line endings cannot hide the
      // blank-line frame separator this splits on.
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = parseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);

        if (frame) {
          onEvent(frame);
        }

        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    // Releases the socket. A cancel on an already-closed stream throws, and
    // there is nothing useful to do about it.
    void reader.cancel().catch(() => {});
  }
}

function open(gameId: string, signal: AbortSignal): Promise<Response> {
  const auth = getAuth();

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (auth) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  return fetch(`${API_URL}/games/${gameId}/events`, { headers, signal });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Follow `gameId` until the returned function is called.
 *
 * The server closes the stream once the game is settled, and the final state
 * carries the result — so the loop stops on its own rather than reconnecting to
 * a game with nothing left to say.
 */
export function subscribeToGame(
  gameId: string,
  handlers: GameStreamHandlers,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  const run = async () => {
    let attempt = 0;
    let finished = false;

    while (!signal.aborted && !finished) {
      try {
        let response = await open(gameId, signal);

        // The access token expired mid-game — an hour of play is entirely
        // normal. One refresh and one retry, matching the api-client's policy.
        if (response.status === 401) {
          const outcome = await refreshAccessToken();
          if (outcome.status === "rejected") {
            // The session is truly over. Match the api-client's policy: wipe
            // the stored auth so listeners flip the UI to signed-out, and stop
            // — reconnecting with a dead token can never succeed.
            clearAuth();
            return;
          }
          if (outcome.status !== "refreshed") {
            // Clerk unreachable; the token may still be good. Retry later.
            throw new Error("Not authorized to watch this game");
          }
          response = await open(gameId, signal);
        }

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed with ${response.status}`);
        }

        // A connection that opened is a healthy one; forget earlier failures so
        // a long game does not inherit a ten-second backoff from its first
        // minute.
        attempt = 0;

        await consume(response.body, (frame) => {
          if (frame.event !== "state") {
            return;
          }

          const state = JSON.parse(frame.data) as ServerGame;
          handlers.onState(state);

          // The server hangs up after this one. Recording it here means the
          // loop exits rather than treating the close as a dropped connection.
          if (state.result !== null) {
            finished = true;
          }
        });
      } catch {
        // Every failure is treated the same: wait, then open again. The screen
        // stays on the last known board meanwhile, which is the truthful thing
        // to show — nothing has been observed to change.
      }

      if (signal.aborted || finished) {
        return;
      }

      await delay(
        Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS),
        signal,
      );
      attempt += 1;
    }
  };

  void run();

  return () => controller.abort();
}
