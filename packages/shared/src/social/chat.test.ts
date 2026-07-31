import { describe, expect, test } from "bun:test";

import {
  CHAT_PHRASES,
  CHAT_PHRASE_IDS,
  CHAT_PHRASE_LIST,
  chatPhraseText,
  chatPhrasesFor,
  isChatPhraseId,
} from "./chat";

describe("the chat catalog", () => {
  test("orders every phrase exactly once", () => {
    expect([...CHAT_PHRASE_IDS].sort().join()).toBe(
      Object.keys(CHAT_PHRASES).sort().join(),
    );
    expect(new Set(CHAT_PHRASE_IDS).size).toBe(CHAT_PHRASE_IDS.length);
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
  });

  test("gives every phrase text to render", () => {
    for (const phrase of CHAT_PHRASE_LIST) {
      expect(phrase.text.trim().length).toBeGreaterThan(0);
    }
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
});
