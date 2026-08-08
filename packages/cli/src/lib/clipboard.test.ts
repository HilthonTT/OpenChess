import { describe, expect, test } from "bun:test";
import { copyToClipboard, osc52, MAX_SEQUENCE_LENGTH } from "./clipboard";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const PREFIX = `${ESC}]52;c;`;

/** A terminal that honours OSC 52, and remembers what it was sent. */
function terminal() {
  const written: string[] = [];

  return {
    isTTY: true,
    write: (chunk: string) => written.push(chunk),
    written,
    /** What the last sequence would have put on the clipboard. */
    clipboard: () => {
      const sequence = written.at(-1) ?? "";
      return Buffer.from(sequence.slice(PREFIX.length, -1), "base64").toString(
        "utf8",
      );
    },
  };
}

describe("osc52", () => {
  test("wraps base64 in the sequence a terminal answers to", () => {
    const sequence = osc52("hello");

    expect(sequence).toBe(`${PREFIX}aGVsbG8=${BEL}`);
  });

  test("encodes as UTF-8, not as code units", () => {
    // The board's pieces are the reason this matters: a FEN is ASCII, but the
    // move list and a PGN's tags are not necessarily.
    const sequence = osc52("Rosé ♞");

    expect(
      Buffer.from(sequence.slice(PREFIX.length, -1), "base64").toString("utf8"),
    ).toBe("Rosé ♞");
  });
});

describe("copyToClipboard", () => {
  test("asks the terminal, and says it did", () => {
    const out = terminal();

    expect(copyToClipboard("e4 e5", out)).toEqual({ ok: true });
    expect(out.clipboard()).toBe("e4 e5");
  });

  test("writes nothing when stdout isn't a terminal", () => {
    // Redirected output is a file or a pipe; an escape sequence in either is
    // corruption of something somebody meant to read.
    const written: string[] = [];
    const outcome = copyToClipboard("e4", {
      write: (chunk: string) => written.push(chunk),
    });

    expect(outcome).toEqual({ ok: false, reason: "this isn't a terminal" });
    expect(written).toEqual([]);
  });

  test("refuses an empty copy rather than clearing the clipboard", () => {
    const out = terminal();

    expect(copyToClipboard("   ", out).ok).toBe(false);
    expect(out.written).toEqual([]);
  });

  test("refuses a payload past what a terminal will take", () => {
    const out = terminal();
    const huge = "x".repeat(MAX_SEQUENCE_LENGTH);

    // Truncation is the failure worth avoiding: half a base64 payload is a
    // clipboard holding half a game, and nothing says so.
    expect(copyToClipboard(huge, out)).toEqual({
      ok: false,
      reason: "it's too long for the terminal's clipboard",
    });
    expect(out.written).toEqual([]);
  });

  test("a broken pipe comes back as a reason, not an exception", () => {
    const outcome = copyToClipboard("e4", {
      isTTY: true,
      write: () => {
        throw new Error("EPIPE");
      },
    });

    expect(outcome).toEqual({ ok: false, reason: "EPIPE" });
  });
});
