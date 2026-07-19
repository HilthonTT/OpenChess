import { afterEach, describe, expect, test } from "bun:test";

import {
  QUEUE_STALE_MS,
  completePairing,
  heartbeat,
  isPairing,
  leave,
  reset,
  takePartner,
} from "./matchmaking";

afterEach(() => {
  reset();
});

describe("takePartner", () => {
  test("an empty queue has nobody to offer", () => {
    expect(takePartner("alice", 0)).toBeNull();
  });

  test("pairs with the longest-waiting player", () => {
    heartbeat("bob", 0);
    heartbeat("carol", 100);

    expect(takePartner("alice", 200)).toBe("bob");
  });

  test("never pairs a player with themselves", () => {
    heartbeat("alice", 0);

    expect(takePartner("alice", 100)).toBeNull();
  });

  test("removes both sides from the queue", () => {
    heartbeat("alice", 0);
    heartbeat("bob", 0);

    expect(takePartner("alice", 100)).toBe("bob");
    // Neither is available to a third player any more.
    expect(takePartner("carol", 200)).toBeNull();
  });

  test("skips a player who stopped polling", () => {
    heartbeat("bob", 0);
    heartbeat("carol", QUEUE_STALE_MS);

    // Bob's last poll is a full staleness window before Carol's, so by the time
    // Alice arrives he is gone and Carol is the match.
    expect(takePartner("alice", QUEUE_STALE_MS + 1)).toBe("carol");
  });

  test("a heartbeat keeps a waiting player fresh", () => {
    heartbeat("bob", 0);
    heartbeat("bob", QUEUE_STALE_MS);

    expect(takePartner("alice", QUEUE_STALE_MS + 1)).toBe("bob");
  });
});

describe("pairing lock", () => {
  test("both sides are marked while the game row is created", () => {
    heartbeat("bob", 0);
    takePartner("alice", 0);

    expect(isPairing("alice")).toBe(true);
    expect(isPairing("bob")).toBe(true);
  });

  test("a mid-pairing player cannot be handed to someone else", () => {
    heartbeat("bob", 0);
    takePartner("alice", 0);
    heartbeat("bob", 0);

    // Bob re-entered the queue (say, a racing poll) while his game with Alice
    // is still being written. He must not end up in two games.
    expect(takePartner("carol", 0)).toBeNull();
  });

  test("completePairing releases both sides", () => {
    heartbeat("bob", 0);
    takePartner("alice", 0);
    completePairing("alice", "bob");

    expect(isPairing("alice")).toBe(false);
    expect(isPairing("bob")).toBe(false);
  });
});

describe("leave", () => {
  test("a player who leaves is not matched", () => {
    heartbeat("bob", 0);
    leave("bob");

    expect(takePartner("alice", 0)).toBeNull();
  });

  test("leaving a queue you are not in is fine", () => {
    expect(() => leave("nobody")).not.toThrow();
  });
});
