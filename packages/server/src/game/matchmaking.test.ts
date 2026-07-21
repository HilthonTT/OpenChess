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
    expect(takePartner("alice", null, 0)).toBeNull();
  });

  test("pairs with the longest-waiting player", () => {
    heartbeat("bob", null, 0);
    heartbeat("carol", null, 100);

    expect(takePartner("alice", null, 200)).toBe("bob");
  });

  test("never pairs a player with themselves", () => {
    heartbeat("alice", null, 0);

    expect(takePartner("alice", null, 100)).toBeNull();
  });

  test("removes both sides from the queue", () => {
    heartbeat("alice", null, 0);
    heartbeat("bob", null, 0);

    expect(takePartner("alice", null, 100)).toBe("bob");
    // Neither is available to a third player any more.
    expect(takePartner("carol", null, 200)).toBeNull();
  });

  test("skips a player who stopped polling", () => {
    heartbeat("bob", null, 0);
    heartbeat("carol", null, QUEUE_STALE_MS);

    // Bob's last poll is a full staleness window before Carol's, so by the time
    // Alice arrives he is gone and Carol is the match.
    expect(takePartner("alice", null, QUEUE_STALE_MS + 1)).toBe("carol");
  });

  test("a heartbeat keeps a waiting player fresh", () => {
    heartbeat("bob", null, 0);
    heartbeat("bob", null, QUEUE_STALE_MS);

    expect(takePartner("alice", null, QUEUE_STALE_MS + 1)).toBe("bob");
  });
});

describe("takePartner by time control", () => {
  test("only pairs players who chose the same clock", () => {
    heartbeat("bob", "blitz", 0);

    // Alice wants bullet; Bob is waiting for blitz — no match either way.
    expect(takePartner("alice", "bullet", 100)).toBeNull();
    // Bob is untouched and still there for a blitz seeker.
    expect(takePartner("carol", "blitz", 200)).toBe("bob");
  });

  test("untimed and timed never mix", () => {
    heartbeat("bob", null, 0);

    expect(takePartner("alice", "rapid", 100)).toBeNull();
    expect(takePartner("carol", null, 200)).toBe("bob");
  });

  test("switching time control moves a waiting player to the new queue", () => {
    heartbeat("bob", "bullet", 0);
    // Bob changes his mind and re-polls for blitz.
    heartbeat("bob", "blitz", 100);

    expect(takePartner("alice", "bullet", 200)).toBeNull();
    expect(takePartner("carol", "blitz", 300)).toBe("bob");
  });
});

describe("pairing lock", () => {
  test("both sides are marked while the game row is created", () => {
    heartbeat("bob", null, 0);
    takePartner("alice", null, 0);

    expect(isPairing("alice")).toBe(true);
    expect(isPairing("bob")).toBe(true);
  });

  test("a mid-pairing player cannot be handed to someone else", () => {
    heartbeat("bob", null, 0);
    takePartner("alice", null, 0);
    heartbeat("bob", null, 0);

    // Bob re-entered the queue (say, a racing poll) while his game with Alice
    // is still being written. He must not end up in two games.
    expect(takePartner("carol", null, 0)).toBeNull();
  });

  test("a mid-pairing player cannot take a second partner either", () => {
    heartbeat("bob", null, 0);
    heartbeat("carol", null, 0);
    takePartner("alice", null, 0);

    // Alice's game with Bob is still being written when a duplicate poll of
    // hers comes around again. Carol is free, but Alice is not.
    expect(takePartner("alice", null, 0)).toBeNull();
  });

  test("completePairing releases both sides", () => {
    heartbeat("bob", null, 0);
    takePartner("alice", null, 0);
    completePairing("alice", "bob");

    expect(isPairing("alice")).toBe(false);
    expect(isPairing("bob")).toBe(false);
  });
});

describe("leave", () => {
  test("a player who leaves is not matched", () => {
    heartbeat("bob", null, 0);
    leave("bob");

    expect(takePartner("alice", null, 0)).toBeNull();
  });

  test("leaving a queue you are not in is fine", () => {
    expect(() => leave("nobody")).not.toThrow();
  });
});
