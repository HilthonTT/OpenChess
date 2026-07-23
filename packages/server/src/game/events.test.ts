import { describe, expect, test } from "bun:test";

import { publishGameChanged, subscribeToGame } from "./events";

/**
 * The in-process half of the notification hub. The Redis half is a fire-and-
 * forget counter that `lib/upstash` disables under test, so what is exercised
 * here is exactly what runs on a single instance — and the path every SSE
 * stream depends on for an instant update.
 */
describe("subscribeToGame", () => {
  test("a subscriber is told when its game changes", () => {
    let calls = 0;
    const stop = subscribeToGame("game-1", () => {
      calls += 1;
    });

    publishGameChanged("game-1");
    expect(calls).toBe(1);

    stop();
  });

  test("every subscriber to a game is told", () => {
    const seen: string[] = [];
    const stopA = subscribeToGame("game-1", () => seen.push("a"));
    const stopB = subscribeToGame("game-1", () => seen.push("b"));

    publishGameChanged("game-1");
    expect(seen.sort()).toEqual(["a", "b"]);

    stopA();
    stopB();
  });

  test("a subscriber hears nothing about another game", () => {
    let calls = 0;
    const stop = subscribeToGame("game-1", () => {
      calls += 1;
    });

    publishGameChanged("game-2");
    expect(calls).toBe(0);

    stop();
  });

  test("unsubscribing stops delivery", () => {
    let calls = 0;
    const stop = subscribeToGame("game-1", () => {
      calls += 1;
    });

    stop();
    publishGameChanged("game-1");

    expect(calls).toBe(0);
  });

  test("unsubscribing twice is harmless", () => {
    const stop = subscribeToGame("game-1", () => {});

    stop();
    expect(() => stop()).not.toThrow();
  });

  test("publishing to a game nobody watches is fine", () => {
    expect(() => publishGameChanged("nobody-here")).not.toThrow();
  });

  test("one throwing listener does not rob the others", () => {
    // A stream that has already errored must not silence its opponent's.
    let reached = false;
    const stopA = subscribeToGame("game-1", () => {
      throw new Error("this stream is broken");
    });
    const stopB = subscribeToGame("game-1", () => {
      reached = true;
    });

    expect(() => publishGameChanged("game-1")).not.toThrow();
    expect(reached).toBe(true);

    stopA();
    stopB();
  });

  test("unsubscribing one leaves the other subscribed", () => {
    let a = 0;
    let b = 0;
    const stopA = subscribeToGame("game-1", () => {
      a += 1;
    });
    const stopB = subscribeToGame("game-1", () => {
      b += 1;
    });

    stopA();
    publishGameChanged("game-1");

    expect(a).toBe(0);
    expect(b).toBe(1);

    stopB();
  });
});
