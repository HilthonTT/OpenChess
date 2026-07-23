import { useUITheme } from "../providers/theme";

export type ErrorHint = { key: string; label: string };

const RETRY_HINT: ErrorHint[] = [{ key: "r", label: "retry" }];

/**
 * The standard error block for a screen body: what went wrong, the message,
 * and which keys dig you out. Screens that can refetch keep the default
 * `r retry` hint; pass `hints` to offer more ways out, or `null` when the
 * screen has no recovery key to offer.
 */
export function ErrorNotice({
  title,
  message,
  hints = RETRY_HINT,
}: {
  title: string;
  message: string;
  hints?: ErrorHint[] | null;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <text fg={theme.gold}>{title}</text>
      <text fg={theme.dim} wrapMode="word">
        {message}
      </text>
      {hints && hints.length > 0 ? (
        <text>
          {hints.map((hint, index) => (
            <span key={hint.key}>
              <span fg={theme.faint}>{index > 0 ? "  " : ""}</span>
              <span fg={theme.cream}>{hint.key}</span>
              <span fg={theme.faint}>{` ${hint.label}`}</span>
            </span>
          ))}
        </text>
      ) : null}
    </box>
  );
}
