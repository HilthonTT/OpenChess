import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { SignedOut } from "../components/signed-out";
import {
  claimPuzzleCollection,
  fetchPuzzleCollections,
  type PuzzleCollectionEntry,
} from "../lib/puzzles";
import { LIST_KEYS } from "../lib/keymaps";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";

const KEYMAP: Keymap = {
  title: "Collections",
  sections: [
    {
      keys: [
        ...LIST_KEYS,
        { keys: "enter", label: "train this collection's theme" },
        { keys: "c", label: "claim a finished one" },
        { keys: "r", label: "refresh" },
      ],
    },
  ],
};

const WIDTH = 64;

const VISIBLE = 8;

export function Collections() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<PuzzleCollectionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchPuzzleCollections()
      .then((collections) => {
        if (!cancelled) {
          setEntries(collections);
          setCursor((current) =>
            Math.min(current, Math.max(0, collections.length - 1)),
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
  const selected = entries?.[cursor] ?? null;

  const claim = useCallback(async () => {
    if (!selected || claiming) {
      return;
    }

    if (!selected.complete) {
      setNote(
        `${selected.name} is not finished — ${selected.solved} of ${selected.target}. Press enter to train it.`,
      );
      return;
    }

    if (selected.claimedAt !== null) {
      setNote(`${selected.name} is already claimed.`);
      return;
    }

    setClaiming(true);
    setNote(null);

    try {
      const result = await claimPuzzleCollection(selected.id);

      if (result.reward) {
        toast.show({
          message: `${selected.name} complete — +${result.reward.xp} xp, +${result.reward.coins} coins`,
          variant: "success",
        });

        if (result.reward.levelAfter > result.reward.levelBefore) {
          toast.show({
            message: `Level up! You reached level ${result.reward.levelAfter}.`,
            variant: "success",
          });
        }
      } else {
        setNote(`${selected.name} was already claimed.`);
      }

      await auth.refresh();
      setAttempt((value) => value + 1);
    } catch (cause) {
      setNote(errorMessage(cause));
    } finally {
      setClaiming(false);
    }
  }, [auth, claiming, selected, toast]);

  const { isTopLayer } = useKeyboardLayer();

  useKeymap(KEYMAP);

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
      case "g":
        setCursor(key.shift ? last : 0);
        break;
      case "r":
        setAttempt((value) => value + 1);
        break;
      case "c":
        void claim();
        break;
      case "return":
      case "space":
        if (selected) {
          void navigate("/puzzles", { state: { theme: selected.theme } });
        }
        break;
    }
  });

  if (!signedIn) {
    return (
      <Frame>
        <SignedOut
          title="Collections need an account"
          message="They are counted off the puzzles the server has scored you on."
        />
      </Frame>
    );
  }

  const done = entries?.filter((entry) => entry.complete).length;

  return (
    <Frame complete={done} total={entries?.length}>
      {error ? (
        <ErrorNotice title="Couldn't load your collections" message={error} />
      ) : !entries ? (
        <Notice text="Loading…" />
      ) : (
        <>
          <List entries={entries} cursor={cursor} loading={loading} />
          <Details entry={selected} note={claiming ? "Claiming…" : note} />
        </>
      )}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "enter", label: "train" },
          { key: "c", label: "claim" },
          { key: "r", label: "refresh" },
        ]}
      />
    </Frame>
  );
}

function Frame({
  complete,
  total,
  children,
}: {
  complete?: number;
  total?: number;
  children: React.ReactNode;
}) {
  const subtitle =
    complete === undefined || total === undefined
      ? "Sets of puzzles, one motif at a time"
      : `${complete} of ${total} finished`;

  return (
    <GameScreen title="Collections" subtitle={subtitle} width={WIDTH}>
      {children}
    </GameScreen>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useUITheme();
  return <text fg={theme.dim}>{text}</text>;
}

const MARK_W = 2;
const NAME_W = 26;
const BAR_W = 12;
const NUM_W = 10;

function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

function bar(solved: number, target: number): string {
  const ratio = Math.min(1, solved / target);
  const filled = ratio === 0 ? 0 : Math.max(1, Math.floor(ratio * BAR_W));

  return "█".repeat(filled) + "·".repeat(BAR_W - filled);
}

function List({
  entries,
  cursor,
  loading,
}: {
  entries: PuzzleCollectionEntry[];
  cursor: number;
  loading: boolean;
}) {
  const theme = useUITheme();

  if (entries.length === 0) {
    return <Notice text="No collections yet — the catalog is empty." />;
  }

  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(VISIBLE / 2), entries.length - VISIBLE),
  );
  const visible = entries.slice(offset, offset + VISIBLE);
  const below = entries.length - offset - VISIBLE;

  const heading = (label: string) => <span fg={theme.faint}>{label}</span>;

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        {heading("".padEnd(MARK_W))}
        {heading("Collection".padEnd(NAME_W))}
        {heading("".padEnd(BAR_W))}
        {heading("Solved".padStart(NUM_W))}
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
  entry: PuzzleCollectionEntry;
  selected: boolean;
  dimmed: boolean;
}) {
  const theme = useUITheme();

  const claimed = entry.claimedAt !== null;
  const mark = claimed ? "✔" : entry.complete ? "★" : "·";
  const markColour = claimed
    ? theme.gold
    : entry.complete
      ? theme.cream
      : theme.faint;

  const name = dimmed ? theme.faint : claimed ? theme.dim : theme.text;

  return (
    <text bg={selected ? theme.selectionBg : undefined}>
      <span fg={markColour}>{mark.padEnd(MARK_W)}</span>
      <span fg={name}>{fit(entry.name, NAME_W)}</span>
      <span
        fg={dimmed ? theme.faint : entry.complete ? theme.gold : theme.walnut}
      >
        {bar(entry.solved, entry.target)}
      </span>
      <span fg={dimmed ? theme.faint : theme.dim}>
        {`${entry.solved}/${entry.target}`.padStart(NUM_W)}
      </span>
    </text>
  );
}

function Details({
  entry,
  note,
}: {
  entry: PuzzleCollectionEntry | null;
  note: string | null;
}) {
  const theme = useUITheme();

  if (!entry) {
    return null;
  }

  const status = entry.claimedAt
    ? `Claimed ${new Date(entry.claimedAt).toLocaleDateString()}`
    : entry.complete
      ? `Finished — press c for +${entry.xpReward} xp and +${entry.coinReward} coins`
      : `${entry.target - entry.solved} to go · +${entry.xpReward} xp, +${entry.coinReward} coins`;

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text fg={theme.dim}>{fit(entry.description, WIDTH - 6)}</text>
      <text fg={theme.faint}>
        {`${entry.themeLabel} · ${entry.available} in the corpus`}
      </text>
      <text fg={entry.complete ? theme.gold : theme.faint}>{status}</text>
      {note ? <text fg={theme.walnut}>{note}</text> : null}
    </box>
  );
}
