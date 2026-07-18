import { useUITheme } from "../providers/theme";

export type Hint = {
  /** The keystroke, drawn as a key cap. */
  key: string;
  label: string;
  /** Current setting the key changes, e.g. the active theme's name. */
  value?: string;
};

type HintBarProps = {
  hints: Hint[];
};

export function HintBar({ hints }: HintBarProps) {
  const theme = useUITheme();

  return (
    <box>
      <text>
        {hints.map((hint, i) => (
          <span key={hint.key}>
            {i > 0 ? <span>{"   "}</span> : null}
            <span
              bg={theme.selectionBg}
              fg={theme.cream}
            >{` ${hint.key} `}</span>
            <span fg={theme.dim}>{` ${hint.label}`}</span>
            {hint.value ? (
              <span fg={theme.walnut}>{` ${hint.value}`}</span>
            ) : null}
          </span>
        ))}
      </text>
    </box>
  );
}
