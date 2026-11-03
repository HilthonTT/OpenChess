"use client";

import type { PersonalityId } from "@openchess/shared";
import { useCallback, useEffect, useRef } from "react";
import type { AiRequest, AiResponse } from "./ai.worker";

type Pending = {
  id: number;
  resolve: (uci: string | null) => void;
};

function spawn(): Worker {
  return new Worker(new URL("./ai.worker.ts", import.meta.url), {
    type: "module",
  });
}

export function useAi() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef<Pending | null>(null);
  const nextId = useRef(1);

  const attach = useCallback((instance: Worker) => {
    instance.onmessage = (event: MessageEvent<AiResponse>) => {
      const current = pending.current;
      if (current && current.id === event.data.id) {
        pending.current = null;
        current.resolve(event.data.uci);
      }
    };
    worker.current = instance;
  }, []);

  useEffect(() => {
    attach(spawn());
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, [attach]);

  // A search cannot be interrupted from outside, so cancelling a busy worker
  // means replacing it. An idle one is left alone.
  const cancel = useCallback(() => {
    if (pending.current) {
      pending.current.resolve(null);
      pending.current = null;
      worker.current?.terminate();
      attach(spawn());
    }
  }, [attach]);

  const think = useCallback(
    (fen: string, history: string[], personality: PersonalityId) => {
      cancel();
      return new Promise<string | null>((resolve) => {
        const id = nextId.current++;
        pending.current = { id, resolve };
        const request: AiRequest = { id, fen, history, personality };
        worker.current?.postMessage(request);
      });
    },
    [cancel],
  );

  return { think, cancel };
}
