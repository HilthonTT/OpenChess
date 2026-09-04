import { describe, expect, test } from "bun:test";

import { isStreamingPath } from "./create-app";

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
    expect(isStreamingPath("/api/games/events/moves")).toBe(false);
    expect(isStreamingPath("/api/eventsomething")).toBe(false);
  });
});
