import { errorMessage } from "./utils";

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

export type NotifyTarget = {
  isTTY?: boolean;
  write: (chunk: string) => unknown;
};

export type NotifyOutcome = { ok: true } | { ok: false; reason: string };

const NAME = "OpenChess";

export const MAX_MESSAGE_LENGTH = 120;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point — this is the filter that keeps them out
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

export function sanitizeMessage(text: string): string {
  const clean = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

  return clean.length > MAX_MESSAGE_LENGTH
    ? `${clean.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
    : clean;
}

export function osc9(text: string): string {
  return `${ESC}]9;${text}${BEL}`;
}

function fromEnvironment(): boolean {
  const value = process.env.OPENCHESS_BELL?.trim().toLowerCase();

  if (value === undefined || value === "") {
    return true;
  }

  return !(
    value === "0" ||
    value === "off" ||
    value === "false" ||
    value === "no"
  );
}

let enabled = fromEnvironment();

export function notificationsEnabled(): boolean {
  return enabled;
}

export function setNotificationsEnabled(value: boolean): void {
  enabled = value;
}

export function notify(
  message: string,
  target: NotifyTarget = process.stdout,
): NotifyOutcome {
  if (!enabled) {
    return { ok: false, reason: "the bell is off" };
  }

  if (!target.isTTY) {
    return { ok: false, reason: "this isn't a terminal" };
  }

  const body = sanitizeMessage(message);

  if (body === "") {
    return { ok: false, reason: "there's nothing to say" };
  }

  try {
    target.write(`${BEL}${osc9(`${NAME} — ${body}`)}`);
  } catch (cause) {
    return { ok: false, reason: errorMessage(cause) };
  }

  return { ok: true };
}
