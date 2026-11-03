/// <reference lib="webworker" />
import {
  findBestMove,
  parseFen,
  toUci,
  type PersonalityId,
} from "@openchess/shared";

export type AiRequest = {
  id: number;
  fen: string;
  history: string[];
  personality: PersonalityId;
};

export type AiResponse = {
  id: number;
  uci: string | null;
};

// The engine searches synchronously, so it lives in a worker: the board keeps
// animating and the clock keeps ticking while the computer thinks.
self.onmessage = (event: MessageEvent<AiRequest>) => {
  const { id, fen, history, personality } = event.data;
  const move = findBestMove(
    parseFen(fen),
    personality,
    history.map((entry) => parseFen(entry)),
  );
  const response: AiResponse = { id, uci: move ? toUci(move) : null };
  self.postMessage(response);
};
