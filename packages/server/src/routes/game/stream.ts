import type { Context } from "hono";
import { type SSEStreamingApi, streamSSE } from "hono/streaming";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { gameVersion, subscribeToGame } from "../../game/events";
import { throwProblem } from "../../lib/problem-details";
import { isShuttingDown, onShutdown } from "../../lib/shutdown";
import type { PlayerEnv } from "../../middlewares/require-user";

const REVALIDATE_MS = 2_000;

const KEEPALIVE_MS = 15_000;

const POST_SETTLE_LINGER_MS = 90_000;

// Each open stream polls Redis (or the database) every couple of seconds, and
// the rate limiter only counts the request that opens one. Cap how many a user
// can hold, and how long any one lives; EventSource reconnects on its own.
const MAX_STREAMS_PER_USER = 6;

const MAX_STREAM_LIFETIME_MS = 60 * 60_000;

const openStreams = new Map<string, number>();

function waitForChange(
  gameId: string,
  signal: AbortSignal,
): Promise<"changed" | "tick"> {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribeShutdown: () => void = () => {};

    const finish = (reason: "changed" | "tick") => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      unsubscribeShutdown();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(reason);
    };

    const onAbort = () => finish("tick");
    const unsubscribe = subscribeToGame(gameId, () => finish("changed"));
    const timer = setTimeout(() => finish("tick"), REVALIDATE_MS);

    signal.addEventListener("abort", onAbort, { once: true });

    unsubscribeShutdown = onShutdown(() => finish("tick"));
  });
}

export async function streamGameState<T extends { result: string | null }>(
  c: Context<PlayerEnv>,
  gameId: string,
  load: () => Promise<T>,
  signature: (state: T) => string,
) {
  const userId = c.get("user").id;

  if ((openStreams.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
    throwProblem(
      HttpStatusCodes.TOO_MANY_REQUESTS,
      "Too many live game streams are open. Close one and try again.",
    );
  }

  // Load once before the 200 goes out, so a 403 or 404 reaches the client as a
  // real error instead of an empty stream that EventSource retries forever.
  let preloaded: T | null = await load();

  openStreams.set(userId, (openStreams.get(userId) ?? 0) + 1);
  const release = () => {
    const left = (openStreams.get(userId) ?? 1) - 1;
    if (left <= 0) {
      openStreams.delete(userId);
    } else {
      openStreams.set(userId, left);
    }
  };

  return streamSSE(c, async (stream) => {
    try {
      await run(stream);
    } finally {
      release();
    }
  });

  async function run(stream: SSEStreamingApi) {
    const expiresAt = Date.now() + MAX_STREAM_LIFETIME_MS;
    let lastSignature: string | null = null;
    let knownVersion = await gameVersion(gameId);
    let quietSince = Date.now();
    let hangUpAt: number | null = null;

    const keepaliveIfQuiet = async () => {
      if (Date.now() - quietSince >= KEEPALIVE_MS) {
        await stream.write(": keepalive\n\n");
        quietSince = Date.now();
      }
    };

    while (
      !stream.aborted &&
      !stream.closed &&
      !isShuttingDown() &&
      Date.now() < expiresAt
    ) {
      const state = preloaded ?? (await load());
      preloaded = null;
      const current = signature(state);

      if (current !== lastSignature) {
        const first = lastSignature === null;
        lastSignature = current;
        quietSince = Date.now();

        await stream.writeSSE({
          event: "state",
          data: JSON.stringify(state),
        });

        if (first && state.result !== null) {
          break;
        }
      } else {
        await keepaliveIfQuiet();
      }

      if (state.result !== null) {
        hangUpAt ??= Date.now() + POST_SETTLE_LINGER_MS;

        if (Date.now() >= hangUpAt) {
          break;
        }
      }

      while (
        !stream.aborted &&
        !stream.closed &&
        !isShuttingDown() &&
        Date.now() < expiresAt &&
        (hangUpAt === null || Date.now() < hangUpAt)
      ) {
        const reason = await waitForChange(gameId, c.req.raw.signal);

        if (stream.aborted || stream.closed) {
          break;
        }

        if (reason === "changed") {
          knownVersion = await gameVersion(gameId);
          break;
        }

        const version = await gameVersion(gameId);

        if (version === null || version !== knownVersion) {
          knownVersion = version;
          break;
        }

        await keepaliveIfQuiet();
      }
    }
  }
}
