import { describe, expect, test } from "bun:test";

import { isStreamingPath } from "./create-app";

/**
 * The request timeout is right for a route that computes an answer and wrong for
 * one that stays open, so the exemption is decided by path. Getting this
 * predicate wrong fails in two directions and neither is loud: too narrow cuts
 * every live game off after five seconds, too broad quietly removes the ceiling
 * from ordinary requests.
 */
describe("isStreamingPath", () => {
  test("the game event stream is exempt", () => {
    expect(isStreamingPath("/api/games/clx0h2k9r0000abcd/events")).toBe(true);
  });

  test("ordinary game routes are not", () => {
    expect(isStreamingPath("/api/games/clx0h2k9r0000abcd")).toBe(false);
    expect(isStreamingPath("/api/games/clx0h2k9r0000abcd/moves")).toBe(false);
    expect(isStreamingPath("/api/games/clx0h2k9r0000abcd/resign")).toBe(false);
  });

  test("nothing else in the API is exempt", () => {
    expect(isStreamingPath("/api/me")).toBe(false);
    expect(isStreamingPath("/api/me/check-in")).toBe(false);
    expect(isStreamingPath("/api/leaderboard")).toBe(false);
    expect(isStreamingPath("/api/health")).toBe(false);
  });

  test("only a trailing segment counts, not the word appearing anywhere", () => {
    // A game whose id merely contains the word must not slip the ceiling.
    expect(isStreamingPath("/api/games/events/moves")).toBe(false);
    expect(isStreamingPath("/api/eventsomething")).toBe(false);
  });
});
