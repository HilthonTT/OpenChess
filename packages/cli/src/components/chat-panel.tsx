import { chatPhraseText, type ChatPhrase } from "@openchess/shared";
import { useUITheme } from "../providers/theme";

export const CHAT_LINES = 4;

export type ChatMessage = {
  id: string;
  phrase: string;
  mine: boolean;
  username: string;
};

export function ChatLog({
  messages,
  nameFor,
}: {
  messages: ChatMessage[];
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
  title?: string;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column">
      <text fg={theme.walnut}>{title}</text>
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
