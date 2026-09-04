import { clearAuth, getAuth } from "./auth";
import { refreshAccessToken } from "./oauth";
import type { ServerGame } from "./games";
import type { SpectatorGame } from "./spectate";

const API_URL = process.env.API_URL ?? "http://localhost:3000/api";

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 10_000;

export type GameStreamHandlers<T = ServerGame> = {
  onState: (game: T) => void;
};

type StreamKind = "player" | "spectator";

const STREAM_PATH: Record<StreamKind, (gameId: string) => string> = {
  player: (gameId) => `${API_URL}/games/${gameId}/events`,
  spectator: (gameId) => `${API_URL}/games/${gameId}/watch/events`,
};

type ParsedEvent = { event: string; data: string };

function parseFrame(raw: string): ParsedEvent | null {
  let event = "message";
  const data: string[] = [];

  for (const line of raw.split("\n")) {
    if (line === "" || line.startsWith(":")) {
      continue;
    }

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");

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
    void reader.cancel().catch(() => {});
  }
}

function open(
  kind: StreamKind,
  gameId: string,
  signal: AbortSignal,
): Promise<Response> {
  const auth = getAuth();

  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (auth) {
    headers.Authorization = `Bearer ${auth.token}`;
  }

  return fetch(STREAM_PATH[kind](gameId), { headers, signal });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function subscribe<T extends { result: string | null }>(
  kind: StreamKind,
  gameId: string,
  handlers: GameStreamHandlers<T>,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  const run = async () => {
    let attempt = 0;
    let finished = false;

    while (!signal.aborted && !finished) {
      try {
        let response = await open(kind, gameId, signal);

        if (response.status === 401) {
          const outcome = await refreshAccessToken();
          if (outcome.status === "rejected") {
            clearAuth();
            return;
          }
          if (outcome.status !== "refreshed") {
            throw new Error("Not authorized to watch this game");
          }
          response = await open(kind, gameId, signal);
        }

        if (!response.ok || !response.body) {
          throw new Error(`Stream failed with ${response.status}`);
        }

        attempt = 0;

        await consume(response.body, (frame) => {
          if (frame.event !== "state") {
            return;
          }

          const state = JSON.parse(frame.data) as T;
          handlers.onState(state);

          if (state.result !== null) {
            finished = true;
          }
        });
      } catch {}

      if (signal.aborted || finished) {
        return;
      }

      await delay(Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS), signal);
      attempt += 1;
    }
  };

  void run();

  return () => controller.abort();
}

export function subscribeToGame(
  gameId: string,
  handlers: GameStreamHandlers<ServerGame>,
): () => void {
  return subscribe("player", gameId, handlers);
}

export function subscribeToSpectatorGame(
  gameId: string,
  handlers: GameStreamHandlers<SpectatorGame>,
): () => void {
  return subscribe("spectator", gameId, handlers);
}
