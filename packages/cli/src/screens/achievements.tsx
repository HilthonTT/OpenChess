import { useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { fetchAchievements, type AchievementEntry } from "../lib/achievements";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { errorMessage } from "../lib/utils";

const WIDTH = 64;
/** Rows in the viewport. Sized so the list plus its chrome fits 80x24. */
const VISIBLE = 10;

export function Achievements() {
  const auth = useAuth();

  const [entries, setEntries] = useState<AchievementEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  /** Bumped to refetch, e.g. after r or a fixed error. */
  const [attempt, setAttempt] = useState(0);

  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchAchievements()
      .then((result) => {
        if (!cancelled) {
          setEntries(result.achievements);
          setCursor((current) =>
            Math.min(current, Math.max(0, result.achievements.length - 1)),
          );
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn, attempt]);

  const count = entries?.length ?? 0;
  const last = Math.max(0, count - 1);

  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !signedIn) {
      return;
    }

    switch (key.name) {
      case "down":
      case "j":
        setCursor((current) => Math.min(current + 1, last));
        break;
      case "up":
      case "k":
        setCursor((current) => Math.max(0, current - 1));
        break;
      case "home":
        setCursor(0);
        break;
      case "end":
        setCursor(last);
        break;
      // g / G, the vim pair for "top" and "bottom".
      case "g":
        setCursor(key.shift ? last : 0);
        break;
      case "r":
        setAttempt((value) => value + 1);
        break;
    }
  });

  if (!signedIn) {
    return (
      <Frame>
        <Notice text="Sign in from the menu to see your achievements." />
      </Frame>
    );
  }

  const unlocked = entries?.filter((entry) => entry.unlockedAt).length;

  return (
    <Frame unlocked={unlocked} total={entries?.length}>
      {error ? (
        <ErrorNotice title="Couldn't load your achievements" message={error} />
      ) : !entries ? (
        <Notice text="Loading…" />
      ) : (
        <>
          <List entries={entries} cursor={cursor} loading={loading} />
          <Details entry={entries[cursor] ?? null} />
        </>
      )}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "r", label: "refresh" },
        ]}
      />
    </Frame>
  );
}

function Frame({
  unlocked,
  total,
  children,
}: {
  unlocked?: number;
  total?: number;
  children: React.ReactNode;
}) {
  const subtitle =
    unlocked === undefined || total === undefined
      ? "Trophies you have earned"
      : `${unlocked} of ${total} unlocked`;

  return (
    <GameScreen title="Achievements" subtitle={subtitle} width={WIDTH}>
      {children}
    </GameScreen>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useUITheme();
  return <text fg={theme.dim}>{text}</text>;
}

/** Column widths, left to right. */
const MARK_W = 2;
const NAME_W = 36;
const NUM_W = 10;

/** Trim an over-long name rather than let it push the columns apart. */
function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

function List({
  entries,
  cursor,
  loading,
}: {
  entries: AchievementEntry[];
  cursor: number;
  loading: boolean;
}) {
  const theme = useUITheme();

  if (entries.length === 0) {
    return <Notice text="No achievements yet — the catalog is empty." />;
  }

  // Keep the cursor mid-window while scrolling so there is always context on
  // both sides of it, clamped at either end of the catalog.
  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(VISIBLE / 2), entries.length - VISIBLE),
  );
  const visible = entries.slice(offset, offset + VISIBLE);
  const below = entries.length - offset - VISIBLE;

  const heading = (label: string) => <span fg={theme.faint}>{label}</span>;

  return (
    // A refresh in flight keeps the old rows on screen, just dimmed, so the
    // list doesn't blank out under the cursor.
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        {heading("".padEnd(MARK_W))}
        {heading("Achievement".padEnd(NAME_W))}
        {heading("XP".padStart(NUM_W))}
        {heading("Coins".padStart(NUM_W))}
      </text>

      {visible.map((entry, index) => (
        <Row
          key={entry.id}
          entry={entry}
          selected={offset + index === cursor}
          dimmed={loading}
        />
      ))}

      <text fg={theme.faint}>
        {offset > 0 ? `↑ ${offset} more` : " "}
        {below > 0 ? `${offset > 0 ? "   " : ""}↓ ${below} more` : ""}
      </text>
    </box>
  );
}

function Row({
  entry,
  selected,
  dimmed,
}: {
  entry: AchievementEntry;
  selected: boolean;
  dimmed: boolean;
}) {
  const theme = useUITheme();

  const done = entry.unlockedAt !== null;
  const name = dimmed ? theme.faint : done ? theme.cream : theme.text;
  const numbers = dimmed ? theme.faint : theme.dim;

  return (
    <text bg={selected ? theme.selectionBg : undefined}>
      <span fg={done ? theme.gold : theme.faint}>
        {(done ? "✔" : "·").padEnd(MARK_W)}
      </span>
      <span fg={name}>{fit(entry.name, NAME_W)}</span>
      <span fg={numbers}>{`+${entry.xpReward}`.padStart(NUM_W)}</span>
      <span fg={numbers}>{`+${entry.coinReward}`.padStart(NUM_W)}</span>
    </text>
  );
}

/** The selected achievement's description and unlock state, under the list. */
function Details({ entry }: { entry: AchievementEntry | null }) {
  const theme = useUITheme();

  if (!entry) {
    return null;
  }

  const status = entry.unlockedAt
    ? `Unlocked ${new Date(entry.unlockedAt).toLocaleDateString()}` +
      (entry.secret ? " · secret" : "")
    : "Locked";

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text fg={theme.dim}>{fit(entry.description, WIDTH - 6)}</text>
      <text fg={entry.unlockedAt ? theme.gold : theme.faint}>{status}</text>
    </box>
  );
}
