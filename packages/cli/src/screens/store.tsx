import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { equipTitle } from "../lib/profile";
import { fetchTitles, purchaseTitle, type Title } from "../lib/store";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import type { UITheme } from "../theme";
import { errorMessage } from "../lib/utils";

const WIDTH = 66;
/** Rows in the viewport. Sized so the list plus its chrome fits 80x24. */
const VISIBLE = 9;

const RARITY_LABELS: Record<Title["rarity"], string> = {
  COMMON: "Common",
  RARE: "Rare",
  EPIC: "Epic",
  LEGENDARY: "Legendary",
};

function rarityColor(rarity: Title["rarity"], theme: UITheme): string {
  switch (rarity) {
    case "COMMON":
      return theme.dim;
    case "RARE":
      return theme.cream;
    case "EPIC":
      return theme.walnut;
    case "LEGENDARY":
      return theme.gold;
  }
}

export function Store() {
  const auth = useAuth();
  const toast = useToast();

  const [titles, setTitles] = useState<Title[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  /** The wallet after a purchase; falls back to the auth profile's number. */
  const [coins, setCoins] = useState<number | null>(null);
  /** True after the first Enter on a buyable title; the next Enter buys. */
  const [confirming, setConfirming] = useState(false);
  /** A purchase or equip round-trip is in flight; Enter is ignored. */
  const [busy, setBusy] = useState(false);
  /** Bumped to refetch, e.g. after r, a purchase, or a fixed error. */
  const [attempt, setAttempt] = useState(0);

  const signedIn = auth.status === "signed-in";

  useEffect(() => {
    if (!signedIn) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchTitles()
      .then((result) => {
        if (!cancelled) {
          setTitles(result.titles);
          setCursor((current) =>
            Math.min(current, Math.max(0, result.titles.length - 1)),
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

  const count = titles?.length ?? 0;
  const last = Math.max(0, count - 1);
  const selected = titles?.[cursor] ?? null;

  const move = useCallback((to: (current: number) => number) => {
    // Moving off the row disarms a pending purchase — the confirmation was
    // for that title, not whichever one Enter lands on next.
    setConfirming(false);
    setCursor(to);
  }, []);

  const refresh = useCallback(() => {
    setAttempt((value) => value + 1);
    // The header's coin count is fed by the auth profile; keep it in step.
    void auth.refresh();
  }, [auth]);

  const buy = useCallback(
    (title: Title) => {
      setBusy(true);
      purchaseTitle(title.id)
        .then((result) => {
          setCoins(result.coins);
          toast.show({
            message: `Bought ${title.label} for ${title.price} coins.`,
            variant: "success",
          });
          refresh();
        })
        .catch((cause) => {
          toast.show({ message: errorMessage(cause), variant: "error" });
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [toast, refresh],
  );

  const toggleEquip = useCallback(
    (title: Title) => {
      setBusy(true);
      equipTitle(title.equipped ? null : title.id)
        .then(() => {
          toast.show({
            message: title.equipped
              ? "Title unequipped."
              : `Equipped ${title.label}.`,
            variant: "success",
          });
          refresh();
        })
        .catch((cause) => {
          toast.show({ message: errorMessage(cause), variant: "error" });
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [toast, refresh],
  );

  const act = useCallback(() => {
    if (!selected || busy) {
      return;
    }

    if (selected.owned) {
      toggleEquip(selected);
      return;
    }

    if (!selected.isPurchasable) {
      toast.show({
        message: "That title is an achievement reward — it can't be bought.",
        variant: "info",
      });
      return;
    }

    if (!selected.affordable) {
      const level = auth.profile?.level;
      toast.show({
        message:
          level !== undefined && level < selected.requiredLevel
            ? `Requires level ${selected.requiredLevel}.`
            : "Not enough coins.",
        variant: "error",
      });
      return;
    }

    if (!confirming) {
      setConfirming(true);
      return;
    }

    setConfirming(false);
    buy(selected);
  }, [selected, busy, confirming, auth.profile, toast, buy, toggleEquip]);

  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !signedIn) {
      return;
    }

    switch (key.name) {
      case "down":
      case "j":
        move((current) => Math.min(current + 1, last));
        break;
      case "up":
      case "k":
        move((current) => Math.max(0, current - 1));
        break;
      case "home":
        move(() => 0);
        break;
      case "end":
        move(() => last);
        break;
      // g / G, the vim pair for "top" and "bottom".
      case "g":
        move(() => (key.shift ? last : 0));
        break;
      case "return":
      case "enter":
        act();
        break;
      case "r":
        setConfirming(false);
        refresh();
        break;
    }
  });

  const onEscape = useCallback(() => {
    if (confirming) {
      setConfirming(false);
      return true;
    }
    return false;
  }, [confirming]);

  if (!signedIn) {
    return (
      <Frame onEscape={onEscape}>
        <Notice text="Sign in from the menu to browse the store." />
      </Frame>
    );
  }

  const balance = coins ?? auth.profile?.coins;
  const owned = titles?.filter((title) => title.owned).length;

  return (
    <Frame
      balance={balance}
      owned={owned}
      total={titles?.length}
      onEscape={onEscape}
    >
      {error ? (
        <ErrorNotice title="Couldn't load the store" message={error} />
      ) : !titles ? (
        <Notice text="Loading…" />
      ) : (
        <>
          <List titles={titles} cursor={cursor} loading={loading} />
          <Details title={selected} confirming={confirming} busy={busy} />
        </>
      )}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "enter", label: "buy / equip" },
          { key: "r", label: "refresh" },
        ]}
      />
    </Frame>
  );
}

function Frame({
  balance,
  owned,
  total,
  onEscape,
  children,
}: {
  balance?: number;
  owned?: number;
  total?: number;
  onEscape: () => boolean;
  children: React.ReactNode;
}) {
  const subtitle =
    owned === undefined || total === undefined
      ? "Titles to wear on the leaderboard"
      : `${balance ?? "?"} coins · ${owned} of ${total} owned`;

  return (
    <GameScreen
      title="Store"
      subtitle={subtitle}
      width={WIDTH}
      onEscape={onEscape}
    >
      {children}
    </GameScreen>
  );
}

function Notice({ text }: { text: string }) {
  const theme = useUITheme();
  return <text fg={theme.dim}>{text}</text>;
}

/** Column widths, left to right. */
const NAME_W = 24;
const RARITY_W = 11;
const PRICE_W = 8;
const STATUS_W = 10;

/** Trim an over-long label rather than let it push the columns apart. */
function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

function List({
  titles,
  cursor,
  loading,
}: {
  titles: Title[];
  cursor: number;
  loading: boolean;
}) {
  const theme = useUITheme();

  if (titles.length === 0) {
    return <Notice text="The store is empty." />;
  }

  // Keep the cursor mid-window while scrolling so there is always context on
  // both sides of it, clamped at either end of the catalog.
  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(VISIBLE / 2), titles.length - VISIBLE),
  );
  const visible = titles.slice(offset, offset + VISIBLE);
  const below = titles.length - offset - VISIBLE;

  const heading = (label: string) => <span fg={theme.faint}>{label}</span>;

  return (
    // A refresh in flight keeps the old rows on screen, just dimmed, so the
    // list doesn't blank out under the cursor.
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        {heading("Title".padEnd(NAME_W))}
        {heading("Rarity".padEnd(RARITY_W))}
        {heading("Price".padStart(PRICE_W))}
        {heading("Status".padStart(STATUS_W))}
      </text>

      {visible.map((title, index) => (
        <Row
          key={title.id}
          title={title}
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
  title,
  selected,
  dimmed,
}: {
  title: Title;
  selected: boolean;
  dimmed: boolean;
}) {
  const theme = useUITheme();

  const status = title.equipped
    ? { label: "equipped", color: theme.gold }
    : title.owned
      ? { label: "owned", color: theme.cream }
      : !title.isPurchasable
        ? { label: "reward", color: theme.faint }
        : { label: "", color: theme.dim };

  const name = dimmed ? theme.faint : title.owned ? theme.cream : theme.text;

  return (
    <text bg={selected ? theme.selectionBg : undefined}>
      <span fg={name}>{fit(title.label, NAME_W)}</span>
      <span fg={dimmed ? theme.faint : rarityColor(title.rarity, theme)}>
        {RARITY_LABELS[title.rarity].padEnd(RARITY_W)}
      </span>
      <span fg={dimmed ? theme.faint : theme.dim}>
        {(title.isPurchasable ? String(title.price) : "—").padStart(PRICE_W)}
      </span>
      <span fg={dimmed ? theme.faint : status.color}>
        {status.label.padStart(STATUS_W)}
      </span>
    </text>
  );
}

/** The selected title's description and what Enter will do to it. */
function Details({
  title,
  confirming,
  busy,
}: {
  title: Title | null;
  confirming: boolean;
  busy: boolean;
}) {
  const theme = useUITheme();

  if (!title) {
    return null;
  }

  const action = busy
    ? { text: "Working…", color: theme.dim }
    : confirming
      ? {
          text: `Buy for ${title.price} coins? Press enter again to confirm · esc cancels`,
          color: theme.gold,
        }
      : title.equipped
        ? { text: "enter unequips this title", color: theme.faint }
        : title.owned
          ? { text: "enter equips this title", color: theme.faint }
          : !title.isPurchasable
            ? { text: "Unlocked by an achievement", color: theme.faint }
            : title.requiredLevel > 0
              ? {
                  text: `Requires level ${title.requiredLevel}${title.affordable ? " · enter buys it" : ""}`,
                  color: theme.faint,
                }
              : { text: "enter buys it", color: theme.faint };

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text fg={theme.dim}>
        {fit(title.description ?? RARITY_LABELS[title.rarity], WIDTH - 6)}
      </text>
      <text fg={action.color}>{action.text}</text>
    </box>
  );
}
