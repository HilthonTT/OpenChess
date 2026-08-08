import { errorMessage } from "./utils";

/**
 * Getting the terminal's attention, over the bell and OSC 9.
 *
 * Two sequences, written together and for the same reason. `BEL` is the bell,
 * and what a terminal does with it is the terminal's business — a sound, a
 * flash, a mark on the tab, an urgency hint the window manager turns into a
 * bouncing dock icon, or nothing at all because the user turned it off, which
 * is exactly where that decision belongs. `ESC ] 9 ; <text> BEL` is the OSC 9
 * notification, which iTerm2, WezTerm, Ghostty, Konsole and Windows Terminal
 * raise as a desktop notification carrying `text`, and which every terminal
 * that has never heard of it discards as an OSC string it does not implement.
 *
 * The argument for asking the terminal is the clipboard's argument again: it
 * reaches the person at the keyboard. Over SSH a spawned `notify-send` would
 * pop a notification on the machine at the far end, where nobody is sitting.
 *
 * Written straight to stdout from underneath the renderer, as OSC 52 is.
 * Neither sequence draws a glyph or moves the cursor, so the frame OpenTUI is
 * holding on screen is untouched by it.
 *
 * @see https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Operating-System-Commands
 */

/** Spelled by code point: a bare control character in source is invisible. */
const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** Where the sequence is written — `process.stdout`, outside tests. */
export type NotifyTarget = {
  /** Absent or false once stdout is redirected, and nothing there reads escapes. */
  isTTY?: boolean;
  write: (chunk: string) => unknown;
};

/** Whether the terminal was asked, and why not when it wasn't. */
export type NotifyOutcome = { ok: true } | { ok: false; reason: string };

/**
 * What a notification names itself as.
 *
 * OSC 9 carries a body and no title, so the notification a desktop shows is
 * attributed to the terminal rather than to this program. Somebody with a
 * terminal open for a build and another for a game is owed the difference.
 */
const NAME = "OpenChess";

/**
 * How long a message we are willing to send.
 *
 * Nothing enforces a limit — the sequence is a body of text and terminals will
 * take a long one — but a desktop notification truncates past a line or two
 * anyway, and everything this sends is a short sentence. The cap is here so
 * that a message assembled from a name that turns out to be enormous stays a
 * notification rather than becoming a wall.
 */
export const MAX_MESSAGE_LENGTH = 120;

/**
 * Control characters, which is the one thing a notification body must not
 * contain: `BEL` ends the OSC string, and everything after it in the same write
 * would be read as terminal input rather than as text. Opponents' names reach
 * this file, so that is not a hypothetical — a name carrying an escape sequence
 * would otherwise be a way to drive somebody else's terminal.
 *
 * The C1 range goes too. `0x9c` is the string terminator in its own right, and
 * a terminal decoding the stream as Latin-1 would honour it.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point — this is the filter that keeps them out
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/** The body as it is safe to send: no control characters, no runs of space. */
export function sanitizeMessage(text: string): string {
  const clean = text.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

  return clean.length > MAX_MESSAGE_LENGTH
    ? `${clean.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`
    : clean;
}

/** The escape sequence that raises a notification saying `text`. */
export function osc9(text: string): string {
  return `${ESC}]9;${text}${BEL}`;
}

/**
 * Whether a bell is wanted at all.
 *
 * On by default, and turned off by `OPENCHESS_BELL` for somebody who wants it
 * off in every session, or by `--no-bell` for one. Two mechanisms because they
 * answer different questions: the environment variable is a setting, the flag
 * is a decision about the game you are about to play.
 */
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

/** What `--bell` and `--no-bell` call, overriding the environment. */
export function setNotificationsEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Ring the terminal, and tell it what about.
 *
 * As with the clipboard there is no acknowledgement to wait for, so `ok` means
 * "the terminal was asked" — the guards below rule out the failures that are
 * knowable before the write.
 *
 * Both sequences go in one write. The bell has to be sent on its own and not
 * merely left to terminate the OSC string, or a terminal that ignores OSC 9
 * would swallow the only part of this it understood.
 */
export function notify(
  message: string,
  target: NotifyTarget = process.stdout,
): NotifyOutcome {
  if (!enabled) {
    return { ok: false, reason: "the bell is off" };
  }

  // Redirected output is a file or a pipe, and neither has a bell to ring or a
  // notification to raise — only bytes to be corrupted by the attempt.
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
