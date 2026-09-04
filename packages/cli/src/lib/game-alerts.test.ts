import { describe, expect, test } from "bun:test";
import { alertFor, QUIET_REPLY_MS, type AlertGame } from "./game-alerts";

const NOW = 1_700_000_000_000;

function game(over: Partial<AlertGame> = {}): AlertGame {
  return {
    turn: "w",
    ply: 0,
    result: null,
    drawOfferFrom: null,
    takebackOfferFrom: null,
    history: [],
    ...over,
  };
}

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
    const previous = game({ turn: "w", ply: 2 });
    const state = game({ turn: "b", ply: 3, history: ["e4", "e5", "Nf3"] });

    expect(
      ask(state, previous, { theirTurnSince: NOW - (QUIET_REPLY_MS - 1) }),
    ).toBeNull();
    expect(ask(state, previous, { theirTurnSince: NOW - QUIET_REPLY_MS })).toBe(
      "hikaru played Nf3 — your move",
    );
  });

  test("says nothing about our own move coming back to us", () => {
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

  test("rings for a takeback request however fast it arrived", () => {
    const previous = game({ turn: "b", ply: 5 });
    const state = game({ turn: "b", ply: 5, takebackOfferFrom: "w" });

    expect(ask(state, previous, { theirTurnSince: null })).toBe(
      "hikaru asks for their move back",
    );
  });

  test("ignores our own takeback request, and its withdrawal", () => {
    const clear = game({ turn: "w", ply: 5 });
    const ours = game({ turn: "w", ply: 5, takebackOfferFrom: "b" });

    expect(ask(ours, clear)).toBeNull();
    expect(ask(clear, ours)).toBeNull();
  });

  test("a rewound ply is a takeback, never a move played", () => {
    const previous = game({ turn: "w", ply: 6, history: ["e4", "e5", "Nf3"] });
    const state = game({ turn: "b", ply: 4, history: ["e4", "e5"] });

    expect(ask(state, previous)).toBe("hikaru gave you your move back");
  });

  test("their move coming back is named as theirs", () => {
    const previous = game({ turn: "b", ply: 6, history: ["e4", "e5", "Nf3"] });
    const state = game({ turn: "w", ply: 5, history: ["e4", "e5"] });

    expect(ask(state, previous)).toBe("hikaru took their move back");
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
    expect(ask(settled, { ...settled })).toBeNull();
  });
});
