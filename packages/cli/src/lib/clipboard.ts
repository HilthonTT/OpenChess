import { Buffer } from "node:buffer";
import { errorMessage } from "./utils";

/**
 * Putting text on the clipboard from inside the terminal, over OSC 52.
 *
 * A program can ask the terminal it is drawn in to set the system clipboard by
 * printing an escape sequence: `ESC ] 52 ; c ; <base64> BEL`. That is the whole
 * mechanism. It is not merely fewer dependencies than shelling out to `pbcopy`,
 * `xclip` or `clip.exe` — it is the only one of the two that works over SSH,
 * where the clipboard worth writing to belongs to the machine at the keyboard
 * and every process this program could spawn is on the machine at the far end.
 *
 * tmux forwards the sequence to the outer terminal under its default
 * `set-clipboard external`, so a multiplexed session needs nothing special.
 *
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands
 */

/** Spelled by code point: a bare control character in source is invisible. */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** Where the sequence is written — `process.stdout`, outside tests. */
export type ClipboardTarget = {
  /** Absent or false once stdout is redirected, and nothing there reads escapes. */
  isTTY?: boolean;
  write: (chunk: string) => unknown;
};

/**
 * Whether the terminal was asked, and why not when it wasn't. Reasons are
 * phrased to be read after "Couldn't copy: ", because a screen shows them.
 */
export type CopyOutcome = { ok: true } | { ok: false; reason: string };

/**
 * How long a sequence we are willing to hand a terminal.
 *
 * Terminals cap the length of an OSC string and differ on what they do past it:
 * xterm truncates, and a truncated base64 payload is a clipboard quietly
 * holding half a game. Refusing outright is the honest failure. 64 KiB is far
 * under every limit worth naming and far over anything this sends — the longest
 * chess game on record is a few kilobytes of PGN.
 */
export const MAX_SEQUENCE_LENGTH = 64 * 1024;

/** The escape sequence that sets the clipboard to `text`. */
export function osc52(text: string): string {
  return `${ESC}]52;c;${Buffer.from(text, "utf8").toString("base64")}${BEL}`;
}

/**
 * Ask the terminal to put `text` on the clipboard.
 *
 * There is no acknowledgement to wait for: the sequence either reaches a
 * terminal that honours it or it does not, and nothing comes back either way.
 * So `ok` means "the terminal was asked", which is as much as can be known —
 * the guards below rule out the failures that *are* knowable ahead of the write.
 */
export function copyToClipboard(
  text: string,
  target: ClipboardTarget = process.stdout,
): CopyOutcome {
  if (text.trim() === "") {
    return { ok: false, reason: "there's nothing to copy" };
  }

  // Redirected output goes to a file or a pipe, and an escape sequence written
  // into either corrupts it with something no reader of that file asked for.
  if (!target.isTTY) {
    return { ok: false, reason: "this isn't a terminal" };
  }

  const sequence = osc52(text);

  if (sequence.length > MAX_SEQUENCE_LENGTH) {
    return { ok: false, reason: "it's too long for the terminal's clipboard" };
  }

  try {
    target.write(sequence);
  } catch (cause) {
    return { ok: false, reason: errorMessage(cause) };
  }

  return { ok: true };
}
