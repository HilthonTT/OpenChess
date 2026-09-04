import { afterEach, describe, expect, test } from "bun:test";

import {
  beginShutdown,
  isShuttingDown,
  onShutdown,
  resetShutdownForTests,
} from "./shutdown";

afterEach(() => {
  resetShutdownForTests();
});

describe("shutdown", () => {
  test("starts at rest", () => {
    expect(isShuttingDown()).toBe(false);
  });

  test("tells every listener once", () => {
    let first = 0;
    let second = 0;

    onShutdown(() => first++);
    onShutdown(() => second++);

    beginShutdown();

    expect(first).toBe(1);
    expect(second).toBe(1);
    expect(isShuttingDown()).toBe(true);
  });

  test("a second signal does not tell them again", () => {
    let calls = 0;
    onShutdown(() => calls++);

    beginShutdown();
    beginShutdown();

    expect(calls).toBe(1);
  });

  test("an unsubscribed listener is not told", () => {
    let calls = 0;
    const unsubscribe = onShutdown(() => calls++);

    unsubscribe();
    beginShutdown();

    expect(calls).toBe(0);
  });

  test("subscribing after the fact runs immediately", () => {
    beginShutdown();

    let calls = 0;
    onShutdown(() => calls++);

    expect(calls).toBe(1);
  });

  test("one throwing listener does not strand the rest", () => {
    let reached = false;

    onShutdown(() => {
      throw new Error("boom");
    });
    onShutdown(() => {
      reached = true;
    });

    expect(() => beginShutdown()).not.toThrow();
    expect(reached).toBe(true);
  });
});
