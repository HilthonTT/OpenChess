import { describe, expect, test } from "bun:test";

import {
  CHAT_PHRASES,
  CHAT_PHRASE_IDS,
  CHAT_PHRASE_LIST,
  chatPhraseText,
  chatPhrasesFor,
  isChatPhraseId,
  isPlayerPhraseId,
  isSpectatorPhraseId,
  SPECTATOR_PHRASE_IDS,
  SPECTATOR_PHRASE_LIST,
} from "./chat";

describe("the chat catalog", () => {
  // Between them the two lists account for the whole catalog: an entry on
  // neither is a phrase nothing can ever send, which is a dead row rather than
  // a feature waiting to be used.
  test("orders every phrase exactly once, across the two conversations", () => {
    expect(
      [...new Set([...CHAT_PHRASE_IDS, ...SPECTATOR_PHRASE_IDS])].sort().join(),
    ).toBe(Object.keys(CHAT_PHRASES).sort().join());

    expect(new Set(CHAT_PHRASE_IDS).size).toBe(CHAT_PHRASE_IDS.length);
    expect(new Set(SPECTATOR_PHRASE_IDS).size).toBe(
      SPECTATOR_PHRASE_IDS.length,
    );
  });

  test("keys each entry by its own id", () => {
    for (const [key, phrase] of Object.entries(CHAT_PHRASES)) {
      expect(phrase.id).toBe(key as never);
    }
  });

  // The picker binds 1-9 to the list, so a tenth phrase would silently become
  // unreachable rather than fail anything.
  test("fits the digit keys", () => {
    expect(CHAT_PHRASE_IDS.length).toBeLessThanOrEqual(9);
    expect(SPECTATOR_PHRASE_IDS.length).toBeLessThanOrEqual(9);
  });

  test("gives every phrase text to render", () => {
    for (const phrase of [...CHAT_PHRASE_LIST, ...SPECTATOR_PHRASE_LIST]) {
      expect(phrase.text.trim().length).toBeGreaterThan(0);
    }
  });

  // The point of the split: a watcher narrating someone else's blunder as
  // "oops" reads as the player who made it, and a player calling their own
  // game "brilliant" reads as nobody at all.
  test("keeps the two conversations apart", () => {
    expect(SPECTATOR_PHRASE_IDS).not.toContain("oops");
    expect(SPECTATOR_PHRASE_IDS).not.toContain("sorry");
    expect(CHAT_PHRASE_IDS).not.toContain("brilliant");
    expect(CHAT_PHRASE_IDS).not.toContain("whatAGame");
  });
});

describe("the two doors", () => {
  test("each admits its own list and refuses the other's", () => {
    expect(isPlayerPhraseId("goodGame")).toBe(true);
    expect(isPlayerPhraseId("brilliant")).toBe(false);

    expect(isSpectatorPhraseId("brilliant")).toBe(true);
    expect(isSpectatorPhraseId("sorry")).toBe(false);
  });

  test("both admit the phrases the two conversations share", () => {
    for (const shared of ["hello", "niceMove", "wellPlayed"] as const) {
      expect(isPlayerPhraseId(shared)).toBe(true);
      expect(isSpectatorPhraseId(shared)).toBe(true);
    }
  });

  test("neither admits something outside the catalog", () => {
    expect(isPlayerPhraseId("say-whatever-i-like")).toBe(false);
    expect(isSpectatorPhraseId("say-whatever-i-like")).toBe(false);
    // Not `in`, so nothing inherited slips past either.
    expect(isPlayerPhraseId("toString")).toBe(false);
    expect(isSpectatorPhraseId("constructor")).toBe(false);
  });
});

describe("isChatPhraseId", () => {
  test("admits a catalog key", () => {
    expect(isChatPhraseId("goodGame")).toBe(true);
  });

  test("rejects one that is not in the catalog", () => {
    expect(isChatPhraseId("say-whatever-i-like")).toBe(false);
  });

  // `hasOwnProperty` rather than `in`, precisely so an inherited key cannot
  // pass the guard the API validates submissions with.
  test("rejects a key inherited from Object.prototype", () => {
    expect(isChatPhraseId("toString")).toBe(false);
    expect(isChatPhraseId("constructor")).toBe(false);
  });
});

describe("chatPhraseText", () => {
  test("renders a known phrase", () => {
    expect(chatPhraseText("wellPlayed")).toBe("Well played");
  });

  // A phrase retired from the catalog is still a message somebody sent; the
  // game it is in has to stay readable.
  test("falls back to the key for a retired phrase", () => {
    expect(chatPhraseText("phraseWeNoLongerOffer")).toBe(
      "phraseWeNoLongerOffer",
    );
  });
});

describe("chatPhrasesFor", () => {
  test("leads with the phrases that fit the moment", () => {
    const ordered = chatPhrasesFor("end");

    expect(ordered[0]?.moment).toBe("end");
    expect(ordered.at(-1)?.moment).not.toBe("end");
  });

  test("still offers the whole catalog, whatever the moment", () => {
    for (const moment of ["start", "any", "end"] as const) {
      const ordered = chatPhrasesFor(moment);

      expect(ordered).toHaveLength(CHAT_PHRASE_LIST.length);
      expect(new Set(ordered.map((phrase) => phrase.id))).toEqual(
        new Set(CHAT_PHRASE_IDS),
      );
    }
  });

  test("orders the watchers' list without borrowing from the players'", () => {
    for (const moment of ["start", "any", "end"] as const) {
      const ordered = chatPhrasesFor(moment, SPECTATOR_PHRASE_LIST);

      expect(new Set(ordered.map((phrase) => phrase.id))).toEqual(
        new Set(SPECTATOR_PHRASE_IDS),
      );
    }
  });
});
