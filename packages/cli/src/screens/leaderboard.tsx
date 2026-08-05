import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { SignedOut } from "../components/signed-out";
import {
  MAX_PAGE,
  SORTS,
  fetchLeaderboard,
  type LeaderboardEntry,
  type LeaderboardSort,
} from "../lib/leaderboard";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { errorMessage } from "../lib/utils";

// The one list screen where `home`, `end` and `g` move by page rather than by
// row, since the rows it is paging through are the whole ladder.
const KEYMAP: Keymap = {
  title: "Leaderboard",
  sections: [
    {
      keys: [
        { keys: "↑↓ / jk", label: "browse the rows on this page" },
        { keys: "←→ / hl / n p", label: "the next and previous page" },
        { keys: "home / end", label: "the first and last page" },
        { keys: "g / shift+g", label: "the same pair, for vim hands" },
        { keys: "enter / space", label: "open that player's profile" },
        { keys: "s", label: "sort by rating, level or wins" },
        { keys: "r", label: "refresh" },
      ],
    },
  ],
};

/** Rows per page. Sized so the table plus its chrome fits an 80x24 terminal. */
const PAGE_SIZE = 15;
const WIDTH = 62;

const SORT_LABELS: Record<LeaderboardSort, string> = {
  rating: "Rating",
  level: "Level",
  wins: "Wins",
};

type Data = { entries: LeaderboardEntry[]; total: number };

/**
 * The ranked player table, one page at a time. Ranks are absolute positions, so
 * the server pages by offset and the page number is the screen's whole state —
 * arrow keys move through it and the sort resets it back to the top.
 */
export function Leaderboard() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [sort, setSort] = useState<LeaderboardSort>("rating");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Which row the cursor is on, within the current page. */
  const [index, setIndex] = useState(0);
  /** Bumped to refetch the current page, e.g. after r or a fixed error. */
  const [attempt, setAttempt] = useState(0);

  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchLeaderboard({ sort, page, limit: PAGE_SIZE })
      .then((result) => {
        if (!cancelled) {
          setData({ entries: result.entries, total: result.total });
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
  }, [sort, page, attempt, signedIn]);

  // The server caps the offset, so the last reachable page is capped too — a
  // held-down arrow key stops at the end rather than earning a 400.
  const pageCount = data
    ? Math.min(Math.max(1, Math.ceil(data.total / PAGE_SIZE)), MAX_PAGE)
    : 1;

  const step = useCallback(
    (delta: number) => {
      setPage((current) => Math.min(Math.max(1, current + delta), pageCount));
    },
    [pageCount],
  );

  /** Sorting reorders every rank, so the old page number means nothing. */
  const cycleSort = useCallback(() => {
    setSort((current) => SORTS[(SORTS.indexOf(current) + 1) % SORTS.length]!);
    setPage(1);
    setIndex(0);
  }, []);

  const entries = data?.entries ?? [];
  const selected = entries[Math.min(index, entries.length - 1)] ?? null;

  const { isTopLayer } = useKeyboardLayer();

  useKeymap(KEYMAP);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !signedIn) {
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        setIndex((value) => Math.max(0, value - 1));
        break;
      case "down":
      case "j":
        setIndex((value) => Math.min(entries.length - 1, value + 1));
        break;
      case "right":
      case "l":
      case "n":
        step(1);
        setIndex(0);
        break;
      case "left":
      case "h":
      case "p":
        step(-1);
        setIndex(0);
        break;
      case "home":
        setPage(1);
        setIndex(0);
        break;
      case "end":
        setPage(pageCount);
        setIndex(0);
        break;
      // g / G, the vim pair for "top" and "bottom".
      case "g":
        setPage(key.shift ? pageCount : 1);
        setIndex(0);
        break;
      // A rank is a name, and a name is a player worth looking at. This is the
      // one place in the app where you meet somebody you have never played.
      case "return":
      case "space":
        if (selected) {
          void navigate("/profile", { state: { username: selected.username } });
        }
        break;
      case "s":
        cycleSort();
        break;
      case "r":
        setAttempt((value) => value + 1);
        break;
    }
  });

  if (!signedIn) {
    return (
      <Frame>
        <SignedOut
          title="The leaderboard needs an account"
          message="Ranks cover every player the server has."
        />
      </Frame>
    );
  }

  return (
    <Frame sort={sort} page={page} pageCount={pageCount} total={data?.total}>
      {error ? (
        <ErrorNotice title="Couldn't load the leaderboard" message={error} />
      ) : !data ? (
        <Notice text="Loading…" />
      ) : (
        <Table
          entries={data.entries}
          sort={sort}
          loading={loading}
          index={index}
        />
      )}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "←→", label: "page" },
          { key: "enter", label: "profile" },
          { key: "s", label: "sort", value: SORT_LABELS[sort] },
          { key: "r", label: "refresh" },
        ]}
      />
    </Frame>
  );
}

function Frame({
  sort,
  page,
  pageCount,
  total,
  children,
}: {
  sort?: LeaderboardSort;
  page?: number;
  pageCount?: number;
  total?: number;
  children: React.ReactNode;
}) {
  const subtitle =
    sort && page && pageCount
      ? `By ${SORT_LABELS[sort].toLowerCase()} · page ${page} of ${pageCount}` +
        (total === undefined ? "" : ` · ${total} players`)
      : "Ranked players";

  return (
    <GameScreen title="Leaderboard" subtitle={subtitle} width={WIDTH}>
      {children}
    </GameScreen>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useUITheme();
  return <text fg={theme.dim}>{text}</text>;
}

/** Column widths, left to right. Ranks are absolute so allow for five digits. */
const RANK_W = 5;
const NAME_W = 22;
const NUM_W = 7;

function Table({
  entries,
  sort,
  loading,
  index,
}: {
  entries: LeaderboardEntry[];
  sort: LeaderboardSort;
  loading: boolean;
  index: number;
}) {
  const theme = useUITheme();

  if (entries.length === 0) {
    return <Notice text="No players on this page." />;
  }

  const heading = (label: string, active: boolean) => (
    <span fg={active ? theme.gold : theme.faint}>{label}</span>
  );

  return (
    // A page in flight keeps the old rows on screen, just dimmed: blanking the
    // table on every keypress makes paging feel like it lost your place.
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        {heading("#".padEnd(RANK_W), false)}
        {heading("Player".padEnd(NAME_W), false)}
        {heading("Rating".padStart(NUM_W), sort === "rating")}
        {heading("Level".padStart(NUM_W), sort === "level")}
        {heading("Wins".padStart(NUM_W), sort === "wins")}
      </text>

      {entries.map((entry, i) => (
        <Row
          key={entry.userId}
          entry={entry}
          dimmed={loading}
          cursor={i === Math.min(index, entries.length - 1)}
        />
      ))}
    </box>
  );
}

/** Trim an over-long username rather than let it push the columns apart. */
function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

function Row({
  entry,
  dimmed,
  cursor,
}: {
  entry: LeaderboardEntry;
  dimmed: boolean;
  cursor: boolean;
}) {
  const theme = useUITheme();

  // Your own row is highlighted so it stays findable while paging — it is the
  // one row anyone is actually looking for. The cursor is drawn as a marker in
  // the rank column rather than as a second background, so the two can be on
  // the same row without one hiding the other.
  const fg = dimmed ? theme.faint : entry.you ? theme.cream : theme.text;
  const numbers = dimmed ? theme.faint : theme.dim;
  const name = entry.title
    ? `${entry.title} ${entry.username}`
    : entry.username;

  return (
    <text bg={entry.you || cursor ? theme.selectionBg : undefined}>
      <span fg={dimmed ? theme.faint : cursor ? theme.gold : theme.walnut}>
        {`${cursor ? "▸" : " "}${String(entry.rank).padEnd(RANK_W - 1)}`}
      </span>
      <span fg={fg}>{fit(name, NAME_W)}</span>
      <span fg={fg}>{String(entry.rating).padStart(NUM_W)}</span>
      <span fg={numbers}>{String(entry.level).padStart(NUM_W)}</span>
      <span fg={numbers}>{String(entry.wins).padStart(NUM_W)}</span>
    </text>
  );
}
