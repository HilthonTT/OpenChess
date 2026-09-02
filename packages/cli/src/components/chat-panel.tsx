import { chatPhraseText, type ChatPhrase } from "@openchess/shared";
import { useUITheme } from "../providers/theme";

/**
 * The two halves of a canned conversation: what has been said, and the picker
 * for saying something.
 *
 * Shared by the board a player is at and the board a watcher is looking at,
 * because the shape of the feature is the same in both — a short log under the
 * position, and nine numbered phrases in place of it while the picker is open.
 * What differs between the two is only the catalog and who is talking, and both
 * of those arrive as props.
 */

/**
 * How much of the log is on screen.
 *
 * Four lines under a board on an 80x24 terminal is what there is room for. The
 * server sends a wider window than this so the screen has something to fall
 * back on, but the transcript is a glance rather than a history: what matters
 * is the last thing said.
 */
export const CHAT_LINES = 4;

export type ChatMessage = {
  id: string;
  phrase: string;
  /** True when the caller is the one who said it. */
  mine: boolean;
  username: string;
};

/**
 * What has been said, newest last.
 *
 * Renders nothing at all until there is something to show, rather than holding
 * an empty box open: most games are played in silence, and a permanently blank
 * pane under the board would cost every one of them four rows.
 */
export function ChatLog({
  messages,
  nameFor,
}: {
  messages: ChatMessage[];
  /**
   * What to call whoever said one. A function rather than a name, because a
   * player's log has exactly one other voice in it and a watcher's has as many
   * as there are people watching.
   */
  nameFor: (message: ChatMessage) => string;
}) {
  const theme = useUITheme();

  if (messages.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column">
      {messages.slice(-CHAT_LINES).map((message) => (
        <text key={message.id}>
          <span fg={message.mine ? theme.walnut : theme.gold}>
            {`${nameFor(message).slice(0, 12)}: `}
          </span>
          {/* The wire carries a key; the text is looked up here. Nothing
              anybody else controls ever reaches this line. */}
          <span fg={message.mine ? theme.dim : theme.cream}>
            {chatPhraseText(message.phrase)}
          </span>
        </text>
      ))}
    </box>
  );
}

export function PhrasePicker({
  phrases,
  title = "Say something — esc to close",
}: {
  phrases: ChatPhrase[];
  /** The line above the grid; a watcher is addressing a different room. */
  title?: string;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column">
      <text fg={theme.walnut}>{title}</text>
      {/* Three to a row: nine phrases stacked would push the board off an
          80x24 terminal, which is the size these screens are drawn for. */}
      {[0, 3, 6].map((start) => (
        <text key={start}>
          {phrases.slice(start, start + 3).map((phrase, i) => (
            <span key={phrase.id}>
              <span fg={theme.cream}>{` ${start + i + 1} `}</span>
              <span fg={theme.dim}>{phrase.text.padEnd(16)}</span>
            </span>
          ))}
        </text>
      ))}
    </box>
  );
}
