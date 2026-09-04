import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

import { gameVersion, subscribeToGame } from "../../game/events";
import { isShuttingDown, onShutdown } from "../../lib/shutdown";
import type { PlayerEnv } from "../../middlewares/require-user";

const REVALIDATE_MS = 2_000;

const KEEPALIVE_MS = 15_000;

const POST_SETTLE_LINGER_MS = 90_000;

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

export function streamGameState<T extends { result: string | null }>(
  c: Context<PlayerEnv>,
  gameId: string,
  load: () => Promise<T>,
  signature: (state: T) => string,
) {
  return streamSSE(c, async (stream) => {
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

    while (!stream.aborted && !stream.closed && !isShuttingDown()) {
      const state = await load();
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
  });
}
