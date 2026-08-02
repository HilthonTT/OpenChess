import { describe, expect, test } from "bun:test";
import { alertFor, QUIET_REPLY_MS, type AlertGame } from "./game-alerts";

const NOW = 1_700_000_000_000;

/** A live game with white to move and nothing said. */
function game(over: Partial<AlertGame> = {}): AlertGame {
  return {
    turn: "w",
    ply: 0,
    result: null,
    drawOfferFrom: null,
    history: [],
    ...over,
  };
}

/** Playing black, opponent thought for a minute, no request of ours in flight. */
function ask(
  state: AlertGame,
  previous: AlertGame,
  over: Partial<Parameters<typeof alertFor>[0]> = {},
) {
  return alertFor({
    state,
    previous,
    you: "b",
    opponent: "hikaru",
    theirTurnSince: NOW - 60_000,
    now: NOW,
    awaitingOurOwn: false,
    ...over,
  });
}

describe("alertFor", () => {
  test("names the move that put the board back on us", () => {
    const previous = game({ turn: "w", ply: 0 });
    const state = game({ turn: "b", ply: 1, history: ["e4"] });

    expect(ask(state, previous)).toBe("hikaru played e4 — your move");
  });

  test("says nothing about a reply that came back straight away", () => {
    // Nobody left the keyboard during a four-second think, and a bullet game
    // that beeped every move would be unplayable.
    const previous = game({ turn: "w", ply: 2 });
    const state = game({ turn: "b", ply: 3, history: ["e4", "e5", "Nf3"] });

    expect(
      ask(state, previous, { theirTurnSince: NOW - (QUIET_REPLY_MS - 1) }),
    ).toBeNull();
    expect(
      ask(state, previous, { theirTurnSince: NOW - QUIET_REPLY_MS }),
    ).toBe("hikaru played Nf3 — your move");
  });

  test("says nothing about our own move coming back to us", () => {
    // The stream echoes it, and sometimes beats the response to it.
    const previous = game({ turn: "b", ply: 1, history: ["e4"] });
    const state = game({ turn: "w", ply: 2, history: ["e4", "e5"] });

    expect(ask(state, previous, { theirTurnSince: null })).toBeNull();
  });

  test("stays quiet while a request of ours is in flight", () => {
    const previous = game({ turn: "w", ply: 0 });
    const state = game({ turn: "b", ply: 1, history: ["e4"] });

    expect(ask(state, previous, { awaitingOurOwn: true })).toBeNull();
  });

  test("rings for a draw offer however fast it arrived", () => {
    // It moves neither the ply nor the result, and the game is waiting on an
    // answer only this terminal can give.
    const previous = game({ turn: "b", ply: 5 });
    const state = game({ turn: "b", ply: 5, drawOfferFrom: "w" });

    expect(ask(state, previous, { theirTurnSince: null })).toBe(
      "hikaru offers a draw",
    );
  });

  test("ignores our own draw offer, and its withdrawal", () => {
    const clear = game({ turn: "w", ply: 5 });
    const ours = game({ turn: "w", ply: 5, drawOfferFrom: "b" });

    expect(ask(ours, clear)).toBeNull();
    expect(ask(clear, ours)).toBeNull();
  });

  test("declines a draw with a bell for nobody: theirs, gone", () => {
    const theirs = game({ turn: "b", ply: 5, drawOfferFrom: "w" });
    const clear = game({ turn: "b", ply: 5 });

    expect(ask(clear, theirs)).toBeNull();
  });

  test("tells us how the game ended, from our own side of it", () => {
    const live = game({ turn: "w", ply: 40 });

    expect(ask(game({ turn: "w", ply: 40, result: "BLACK_WIN" }), live)).toBe(
      "You beat hikaru",
    );
    expect(ask(game({ turn: "w", ply: 40, result: "WHITE_WIN" }), live)).toBe(
      "hikaru beat you",
    );
    expect(ask(game({ turn: "w", ply: 40, result: "DRAW" }), live)).toBe(
      "Your game with hikaru is a draw",
    );
    expect(ask(game({ turn: "w", ply: 0, result: "ABORTED" }), live)).toBe(
      "hikaru aborted your game",
    );
  });

  test("the result outranks the move that delivered it", () => {
    // A mate is one notification, not a move and then a result.
    const previous = game({ turn: "w", ply: 40 });
    const state = game({
      turn: "b",
      ply: 41,
      result: "WHITE_WIN",
      history: ["Qh7#"],
    });

    expect(ask(state, previous)).toBe("hikaru beat you");
  });

  test("rings once for the end, not again for every state after it", () => {
    const settled = game({ turn: "w", ply: 40, result: "DRAW" });

    expect(ask(settled, settled)).toBeNull();
    // A message arriving after the result — the "good game" the stream stays
    // open for — changes nothing here and must not ring a second time.
    expect(ask(settled, { ...settled })).toBeNull();
  });
});
