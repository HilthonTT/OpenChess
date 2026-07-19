import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import {
  MAX_PAGE,
  SORTS,
  fetchLeaderboard,
  type LeaderboardEntry,
  type LeaderboardSort,
} from "../lib/leaderboard";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { errorMessage } from "../lib/utils";

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

  const [sort, setSort] = useState<LeaderboardSort>("rating");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
  }, []);

  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !signedIn) {
      return;
    }

    switch (key.name) {
      case "right":
      case "l":
      case "n":
        step(1);
        break;
      case "left":
      case "h":
      case "p":
        step(-1);
        break;
      case "home":
        setPage(1);
        break;
      case "end":
        setPage(pageCount);
        break;
      // g / G, the vim pair for "top" and "bottom".
      case "g":
        setPage(key.shift ? pageCount : 1);
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
        <Notice text="Sign in from the menu to see the leaderboard." />
      </Frame>
    );
  }

  return (
    <Frame sort={sort} page={page} pageCount={pageCount} total={data?.total}>
      {error ? (
        <ErrorBody message={error} />
      ) : !data ? (
        <Notice text="Loading…" />
      ) : (
        <Table entries={data.entries} sort={sort} loading={loading} />
      )}

      <HintBar
        hints={[
          { key: "←→", label: "page" },
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

function ErrorBody({ message }: { message: string }) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" alignItems="center" gap={1}>
      <text fg={theme.gold}>Couldn't load the leaderboard</text>
      <text fg={theme.dim}>{message}</text>
      <text>
        <span fg={theme.cream}>r</span>
        <span fg={theme.faint}> retry</span>
      </text>
    </box>
  );
}

/** Column widths, left to right. Ranks are absolute so allow for five digits. */
const RANK_W = 5;
const NAME_W = 22;
const NUM_W = 7;

function Table({
  entries,
  sort,
  loading,
}: {
  entries: LeaderboardEntry[];
  sort: LeaderboardSort;
  loading: boolean;
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

      {entries.map((entry) => (
        <Row key={entry.userId} entry={entry} dimmed={loading} />
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

function Row({ entry, dimmed }: { entry: LeaderboardEntry; dimmed: boolean }) {
  const theme = useUITheme();

  // Your own row is highlighted so it stays findable while paging — it is the
  // one row anyone is actually looking for.
  const fg = dimmed ? theme.faint : entry.you ? theme.cream : theme.text;
  const numbers = dimmed ? theme.faint : theme.dim;
  const name = entry.title
    ? `${entry.title} ${entry.username}`
    : entry.username;

  return (
    <text bg={entry.you ? theme.selectionBg : undefined}>
      <span fg={dimmed ? theme.faint : theme.walnut}>
        {String(entry.rank).padEnd(RANK_W)}
      </span>
      <span fg={fg}>{fit(name, NAME_W)}</span>
      <span fg={fg}>{String(entry.rating).padStart(NUM_W)}</span>
      <span fg={numbers}>{String(entry.level).padStart(NUM_W)}</span>
      <span fg={numbers}>{String(entry.wins).padStart(NUM_W)}</span>
    </text>
  );
}
