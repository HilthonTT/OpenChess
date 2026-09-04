import { Buffer } from "node:buffer";
import { errorMessage } from "./utils";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

export type ClipboardTarget = {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
};

export type CopyOutcome = { ok: true } | { ok: false; reason: string };

export const MAX_SEQUENCE_LENGTH = 64 * 1024;

export function osc52(text: string): string {
  return `${ESC}]52;c;${Buffer.from(text, "utf8").toString("base64")}${BEL}`;
}

export function copyToClipboard(
  text: string,
  target: ClipboardTarget = process.stdout,
): CopyOutcome {
  if (text.trim() === "") {
    return { ok: false, reason: "there's nothing to copy" };
  }

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
