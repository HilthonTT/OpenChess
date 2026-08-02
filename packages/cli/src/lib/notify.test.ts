import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  MAX_MESSAGE_LENGTH,
  notificationsEnabled,
  notify,
  osc9,
  sanitizeMessage,
  setNotificationsEnabled,
} from "./notify";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** A terminal that honours both sequences, and remembers what it was sent. */
function terminal() {
  const written: string[] = [];

  return {
    isTTY: true,
    write: (chunk: string) => written.push(chunk),
    written,
    /** What the last write would have shown as a notification. */
    body: () => {
      const chunk = written.at(-1) ?? "";
      return chunk.slice(`${BEL}${ESC}]9;`.length, -1);
    },
  };
}

const wasEnabled = notificationsEnabled();

beforeEach(() => setNotificationsEnabled(true));
afterEach(() => setNotificationsEnabled(wasEnabled));

describe("osc9", () => {
  test("wraps the text in the sequence a terminal answers to", () => {
    expect(osc9("your move")).toBe(`${ESC}]9;your move${BEL}`);
  });
});

describe("sanitizeMessage", () => {
  test("keeps ordinary text as it is", () => {
    expect(sanitizeMessage("hikaru played Nf3 — your move")).toBe(
      "hikaru played Nf3 — your move",
    );
  });

  test("strips the control characters that would end the sequence early", () => {
    // The names in these messages come from other players. A name carrying a
    // BEL would close the OSC string and leave whatever followed it to be read
    // as terminal input rather than as text.
    const hostile = `${BEL}${ESC}]0;pwned${BEL}`;

    expect(sanitizeMessage(`${hostile} offers a draw`)).toBe(
      "]0;pwned offers a draw",
    );
    expect(sanitizeMessage(hostile)).not.toContain(BEL);
    expect(sanitizeMessage(hostile)).not.toContain(ESC);
  });

  test("strips C1 too, where the string terminator also lives", () => {
    expect(sanitizeMessage(`draw${String.fromCharCode(0x9c)}offer`)).toBe(
      "draw offer",
    );
  });

  test("collapses the whitespace a stripped character leaves behind", () => {
    expect(sanitizeMessage("  your\n\tmove  ")).toBe("your move");
  });

  test("truncates a message longer than a notification would show", () => {
    const long = sanitizeMessage("x".repeat(MAX_MESSAGE_LENGTH * 2));

    expect(long).toHaveLength(MAX_MESSAGE_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("notify", () => {
  test("rings the bell, then says what about", () => {
    const out = terminal();

    expect(notify("your move", out)).toEqual({ ok: true });
    // One write, and the bell is in it on its own: a terminal that ignores
    // OSC 9 would otherwise swallow the only part of this it understands.
    expect(out.written).toHaveLength(1);
    expect(out.written[0]?.startsWith(BEL)).toBe(true);
    expect(out.body()).toBe("OpenChess — your move");
  });

  test("writes nothing when stdout isn't a terminal", () => {
    const written: string[] = [];
    const outcome = notify("your move", {
      write: (chunk: string) => written.push(chunk),
    });

    expect(outcome).toEqual({ ok: false, reason: "this isn't a terminal" });
    expect(written).toEqual([]);
  });

  test("stays silent once the bell is off", () => {
    const out = terminal();
    setNotificationsEnabled(false);

    expect(notify("your move", out)).toEqual({
      ok: false,
      reason: "the bell is off",
    });
    expect(out.written).toEqual([]);
  });

  test("refuses a message with nothing left in it", () => {
    const out = terminal();

    expect(notify(`  ${BEL} `, out).ok).toBe(false);
    expect(out.written).toEqual([]);
  });

  test("a broken pipe comes back as a reason, not an exception", () => {
    expect(
      notify("your move", {
        isTTY: true,
        write: () => {
          throw new Error("EPIPE");
        },
      }),
    ).toEqual({ ok: false, reason: "EPIPE" });
  });
});
