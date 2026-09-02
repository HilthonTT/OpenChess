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

/**
 * Puzzle collections.
 *
 * A set is a motif and a number — twenty pins, thirty mates in two — and this
 * screen is the two things you can do about one: see how far along it you are,
 * and, on the ones you have finished, take the reward.
 *
 * Nothing here counts anything. Progress arrives from the server as a count of
 * the puzzles you have already solved carrying that theme, which is why a
 * collection can open with fourteen of twenty already done on the first visit:
 * it is not new progress, it is old work being read a new way.
 *
 * `enter` on an unfinished collection goes and trains it, rather than doing
 * nothing — the natural answer to "I am six pins short" is six pins, and the
 * trainer already takes a theme.
 */

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
/** Rows in the viewport. Sized so the list plus its chrome fits 80x24. */
const VISIBLE = 8;

export function Collections() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<PuzzleCollectionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  /** What the last claim said, under the list. */
  const [note, setNote] = useState<string | null>(null);
  /** A claim is on the wire; `c` is ignored until it answers. */
  const [claiming, setClaiming] = useState(false);
  /** Bumped to refetch, e.g. after r, a claim, or a fixed error. */
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

  /**
   * Take the reward for the selected collection.
   *
   * The refetch afterwards is not decoration: a claim moves the player's coins
   * and XP, and the header those are shown in is read from the auth provider,
   * so both have to be told. A claim that turns out to have been paid already
   * comes back with a null reward and says so rather than pretending to pay
   * twice.
   */
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
      // g / G, the vim pair for "top" and "bottom".
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
        // Straight to the trainer, filtered to this collection's theme. The
        // answer to "I am six pins short" is six pins.
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

/** Column widths, left to right. */
const MARK_W = 2;
const NAME_W = 26;
const BAR_W = 12;
const NUM_W = 10;

/** Trim an over-long name rather than let it push the columns apart. */
function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

/**
 * A progress bar in `BAR_W` cells.
 *
 * Rounded down except that any progress at all shows one cell: a player who has
 * solved one of thirty should see that they have started, and a bar that reads
 * empty at 1/30 says the opposite of what is true.
 */
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
  // Three states, and the mark is what tells them apart at a glance: done and
  // paid, done and owed, still going. The middle one is the whole reason the
  // screen has a key.
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
      {/* The corpus size, because the target is fixed and this is not: "20 of
          247 in the corpus" is the honest reading of how much room is left. */}
      <text fg={theme.faint}>
        {`${entry.themeLabel} · ${entry.available} in the corpus`}
      </text>
      <text fg={entry.complete ? theme.gold : theme.faint}>{status}</text>
      {note ? <text fg={theme.walnut}>{note}</text> : null}
    </box>
  );
}
