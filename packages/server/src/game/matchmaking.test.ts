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

/**
 * These run against the in-process backend: `lib/upstash` forces the client to
 * null under test, so `bun test` needs no Redis and never talks to a real one.
 * The two backends are held to the same contract, so what is asserted here is
 * the contract, not the implementation.
 */
afterEach(async () => {
  await reset();
});

describe("takePartner", () => {
  test("an empty queue has nobody to offer", async () => {
    expect(await takePartner("alice", null, 0)).toBeNull();
  });

  test("pairs with the longest-waiting player", async () => {
    await heartbeat("bob", null, 0);
    await heartbeat("carol", null, 100);

    expect(await takePartner("alice", null, 200)).toBe("bob");
  });

  test("never pairs a player with themselves", async () => {
    await heartbeat("alice", null, 0);

    expect(await takePartner("alice", null, 100)).toBeNull();
  });

  test("removes both sides from the queue", async () => {
    await heartbeat("alice", null, 0);
    await heartbeat("bob", null, 0);

    expect(await takePartner("alice", null, 100)).toBe("bob");
    // Neither is available to a third player any more.
    expect(await takePartner("carol", null, 200)).toBeNull();
  });

  test("skips a player who stopped polling", async () => {
    await heartbeat("bob", null, 0);
    await heartbeat("carol", null, QUEUE_STALE_MS);

    // Bob's last poll is a full staleness window before Carol's, so by the time
    // Alice arrives he is gone and Carol is the match.
    expect(await takePartner("alice", null, QUEUE_STALE_MS + 1)).toBe("carol");
  });

  test("a heartbeat keeps a waiting player fresh", async () => {
    await heartbeat("bob", null, 0);
    await heartbeat("bob", null, QUEUE_STALE_MS);

    expect(await takePartner("alice", null, QUEUE_STALE_MS + 1)).toBe("bob");
  });

  test("a heartbeat on the same clock does not cost seniority", async () => {
    await heartbeat("bob", null, 0);
    await heartbeat("carol", null, 100);
    // Bob polls again. He was first and must stay first.
    await heartbeat("bob", null, 200);

    expect(await takePartner("alice", null, 300)).toBe("bob");
  });
});

describe("takePartner by time control", () => {
  test("only pairs players who chose the same clock", async () => {
    await heartbeat("bob", "blitz", 0);

    // Alice wants bullet; Bob is waiting for blitz — no match either way.
    expect(await takePartner("alice", "bullet", 100)).toBeNull();
    // Bob is untouched and still there for a blitz seeker.
    expect(await takePartner("carol", "blitz", 200)).toBe("bob");
  });

  test("untimed and timed never mix", async () => {
    await heartbeat("bob", null, 0);

    expect(await takePartner("alice", "rapid", 100)).toBeNull();
    expect(await takePartner("carol", null, 200)).toBe("bob");
  });

  test("switching time control moves a waiting player to the new queue", async () => {
    await heartbeat("bob", "bullet", 0);
    // Bob changes his mind and re-polls for blitz.
    await heartbeat("bob", "blitz", 100);

    expect(await takePartner("alice", "bullet", 200)).toBeNull();
    expect(await takePartner("carol", "blitz", 300)).toBe("bob");
  });

  test("a player waiting on one clock is passed over, not consumed", async () => {
    await heartbeat("bob", "blitz", 0);
    await heartbeat("carol", "bullet", 100);

    // Alice takes the bullet seeker from behind the blitz one.
    expect(await takePartner("alice", "bullet", 200)).toBe("carol");
    // Bob is still queued for the clock he asked for.
    expect(await takePartner("dave", "blitz", 300)).toBe("bob");
  });
});

describe("pairing lock", () => {
  test("both sides are marked while the game row is created", async () => {
    await heartbeat("bob", null, 0);
    await takePartner("alice", null, 0);

    expect(await isPairing("alice")).toBe(true);
    expect(await isPairing("bob")).toBe(true);
  });

  test("a mid-pairing player cannot be handed to someone else", async () => {
    await heartbeat("bob", null, 0);
    await takePartner("alice", null, 0);
    await heartbeat("bob", null, 0);

    // Bob re-entered the queue (say, a racing poll) while his game with Alice
    // is still being written. He must not end up in two games.
    expect(await takePartner("carol", null, 0)).toBeNull();
  });

  test("a mid-pairing player cannot take a second partner either", async () => {
    await heartbeat("bob", null, 0);
    await heartbeat("carol", null, 0);
    await takePartner("alice", null, 0);

    // Alice's game with Bob is still being written when a duplicate poll of
    // hers comes around again. Carol is free, but Alice is not.
    expect(await takePartner("alice", null, 0)).toBeNull();
  });

  test("completePairing releases both sides", async () => {
    await heartbeat("bob", null, 0);
    await takePartner("alice", null, 0);
    await completePairing("alice", "bob");

    expect(await isPairing("alice")).toBe(false);
    expect(await isPairing("bob")).toBe(false);
  });

  test("completePairing with nothing to release is fine", async () => {
    await expect(completePairing()).resolves.toBeUndefined();
  });
});

describe("leave", () => {
  test("a player who leaves is not matched", async () => {
    await heartbeat("bob", null, 0);
    await leave("bob");

    expect(await takePartner("alice", null, 0)).toBeNull();
  });

  test("leaving a queue you are not in is fine", async () => {
    await expect(leave("nobody")).resolves.toBeUndefined();
  });
});
