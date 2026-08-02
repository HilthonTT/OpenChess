import { useCallback, useEffect, useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import {
  acceptFriend,
  addFriend,
  declineFriend,
  lastSeenLabel,
  listFriends,
  removeFriend,
  type Friend,
  type PresenceState,
} from "../lib/friends";
import { searchPlayers, type PlayerSearchResult } from "../lib/players";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";

const LIST_KEYMAP: Keymap = {
  title: "Friends",
  sections: [
    {
      title: "Getting around",
      keys: [
        { keys: "↑↓ / jk", label: "browse" },
        { keys: "←→ / tab", label: "your friends, who asked you, who you asked" },
        { keys: "r", label: "refresh" },
      ],
    },
    {
      title: "The highlighted player",
      keys: [
        { keys: "enter", label: "open their profile — or accept, on the inbox" },
        { keys: "p", label: "open their profile" },
        { keys: "c", label: "challenge them, with their name filled in" },
        { keys: "d", label: "decline their request, on the inbox" },
        { keys: "x", label: "unfriend, or withdraw — pressed twice to confirm" },
      ],
    },
    {
      title: "Somebody else",
      keys: [{ keys: "a", label: "search for a player by name" }],
    },
  ],
};

const SEARCH_KEYMAP: Keymap = {
  title: "Friends — add somebody",
  escape: "back to the lists",
  sections: [
    {
      keys: [
        { keys: "", label: "type a name; matches appear as you go" },
        { keys: "↑↓", label: "pick one of them" },
        { keys: "enter", label: "ask them to be friends" },
      ],
    },
  ],
};

const TITLE = "Friends";
const SUBTITLE = "Who's around, and who's asked";
const WIDTH = 62;

/**
 * How often the lists are refreshed.
 *
 * Slower than the challenge screen's poll, because what it is watching moves
 * slower: presence is only accurate to about a minute at the source, so polling
 * it every three seconds would ask ten times for each answer that can change.
 * A friend request arriving a few seconds late costs nobody anything.
 */
const POLL_MS = 10_000;

export function Friends() {
  const auth = useAuth();
  const theme = useUITheme();

  if (auth.status === "checking") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <text fg={theme.dim}>Checking your session…</text>
      </GameScreen>
    );
  }

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.gold}>Friends need an account</text>
          <text fg={theme.dim}>
            Sign in from the home screen, then come back.
          </text>
        </box>
      </GameScreen>
    );
  }

  return <FriendList />;
}

/** Which panel the cursor is in. */
type Pane = "friends" | "incoming" | "outgoing";

const PANES: Pane[] = ["friends", "incoming", "outgoing"];

const PANE_LABEL: Record<Pane, string> = {
  friends: "Friends",
  incoming: "Asked you",
  outgoing: "You asked",
};

function FriendList() {
  const theme = useUITheme();
  const toast = useToast();
  const navigate = useNavigate();
  const { isTopLayer } = useKeyboardLayer();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<Friend[]>([]);
  const [outgoing, setOutgoing] = useState<Friend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);

  // Stood down while the search is up, on the same condition the keyboard
  // handler below tests: those are the search's keys, not this list's.
  useKeymap(adding ? null : LIST_KEYMAP);

  const [pane, setPane] = useState<Pane>("friends");
  const [index, setIndex] = useState(0);
  /** Removing is one keypress from being irreversible; `x` again confirms it. */
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const apply = useCallback((lists: Awaited<ReturnType<typeof listFriends>>) => {
    setFriends(lists.friends);
    setIncoming(lists.incoming);
    setOutgoing(lists.outgoing);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const lists = await listFriends();
        if (!cancelled) {
          apply(lists);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      }

      // Guarded so a request still in flight at unmount cannot reschedule the
      // loop onto a screen that is no longer there.
      if (!cancelled) {
        timer = setTimeout(() => void load(), POLL_MS);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [apply]);

  const rows =
    pane === "friends" ? friends : pane === "incoming" ? incoming : outgoing;
  const selected = rows[Math.min(index, rows.length - 1)] ?? null;

  const refresh = useCallback(async () => {
    try {
      apply(await listFriends());
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, [apply]);

  /** Run an action against the selected row, then resync from the server. */
  const act = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setPending(true);
      setNote(null);

      try {
        await action();
        setNote(label);
        await refresh();
      } catch (cause) {
        setNote(errorMessage(cause));
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  /**
   * Challenge a friend.
   *
   * Handed to the Challenges screen with the name filled in rather than sent
   * from here: a challenge carries a clock, a colour and a variant, and the
   * screen that already asks for all three is the honest place to send one
   * from. This is the shortcut, not a second way to do it.
   */
  const challenge = useCallback(
    (username: string) => {
      void navigate("/challenges", { state: { opponent: username } });
    },
    [navigate],
  );

  const openProfile = useCallback(
    (username: string) => {
      void navigate("/profile", { state: { username } });
    },
    [navigate],
  );

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || adding || pending) {
      return;
    }

    // Any key that is not the confirm calls the pending removal off.
    if (confirmingRemove && key.name !== "x") {
      setConfirmingRemove(false);
    }

    switch (key.name) {
      case "up":
      case "k":
        setIndex((value) => Math.max(0, value - 1));
        break;
      case "down":
      case "j":
        setIndex((value) => Math.min(rows.length - 1, value + 1));
        break;
      case "tab":
      case "right":
      case "l":
        setPane((value) => PANES[(PANES.indexOf(value) + 1) % PANES.length]!);
        setIndex(0);
        break;
      case "left":
      case "h":
        setPane(
          (value) =>
            PANES[(PANES.indexOf(value) + PANES.length - 1) % PANES.length]!,
        );
        setIndex(0);
        break;
      case "return":
      case "space":
        if (!selected) {
          break;
        }
        // On the inbox, enter is the answer to the question the row is asking;
        // everywhere else there is no question, so it opens the player.
        if (pane === "incoming") {
          void act(
            `${selected.username} is now a friend.`,
            () => acceptFriend(selected.id),
          );
        } else {
          openProfile(selected.username);
        }
        break;
      case "p":
        if (selected) {
          openProfile(selected.username);
        }
        break;
      case "c":
        if (selected && pane === "friends") {
          challenge(selected.username);
        }
        break;
      case "d":
        if (selected && pane === "incoming") {
          void act("Declined.", () => declineFriend(selected.id));
        }
        break;
      case "x":
        if (!selected || pane === "incoming") {
          break;
        }
        if (confirmingRemove) {
          setConfirmingRemove(false);
          void act(
            pane === "friends"
              ? `${selected.username} removed.`
              : "Request withdrawn.",
            () => removeFriend(selected.id),
          );
        } else {
          setConfirmingRemove(true);
        }
        break;
      case "a":
        setAdding(true);
        break;
      case "r":
        void refresh();
        break;
    }
  });

  if (adding) {
    return (
      <AddFriend
        onDone={(message) => {
          setAdding(false);
          toast.show({ message, variant: "success" });
          void refresh();
        }}
        onCancel={() => setAdding(false)}
      />
    );
  }

  const status = confirmingRemove
    ? pane === "friends"
      ? `Remove ${selected?.username}? Press x again to confirm`
      : "Withdraw this request? Press x again to confirm"
    : note;

  return (
    <GameScreen
      title={TITLE}
      subtitle={SUBTITLE}
      width={WIDTH}
      onEscape={() => {
        if (confirmingRemove) {
          setConfirmingRemove(false);
          return true;
        }
        return false;
      }}
    >
      {error && !loaded ? (
        <ErrorNotice title="Couldn't load your friends" message={error} />
      ) : (
        <>
          <Panel
            label={PANE_LABEL.friends}
            rows={friends}
            active={pane === "friends"}
            index={index}
            empty="Nobody yet — press a to find someone."
          />
          <Panel
            label={PANE_LABEL.incoming}
            rows={incoming}
            active={pane === "incoming"}
            index={index}
            empty="—"
          />
          <Panel
            label={PANE_LABEL.outgoing}
            rows={outgoing}
            active={pane === "outgoing"}
            index={index}
            empty="—"
          />
        </>
      )}

      {status ? <text fg={theme.gold}>{status}</text> : null}

      <HintBar
        hints={
          pane === "incoming"
            ? [
                { key: "↑↓", label: "browse" },
                { key: "←→", label: "switch" },
                { key: "enter", label: "accept" },
                { key: "d", label: "decline" },
                { key: "a", label: "add" },
              ]
            : [
                { key: "↑↓", label: "browse" },
                { key: "←→", label: "switch" },
                { key: "enter", label: "profile" },
                ...(pane === "friends"
                  ? [{ key: "c", label: "challenge" }]
                  : []),
                { key: "x", label: pane === "friends" ? "remove" : "withdraw" },
                { key: "a", label: "add" },
              ]
        }
      />
    </GameScreen>
  );
}

const NAME_W = 24;
const PRESENCE_W = 12;

/** How each presence state is drawn. A dot, so the column reads at a glance. */
const PRESENCE_MARK: Record<PresenceState, string> = {
  playing: "◉",
  online: "●",
  offline: "○",
};

function presenceColor(state: PresenceState, theme: ReturnType<typeof useUITheme>) {
  return state === "online"
    ? theme.gold
    : state === "playing"
      ? theme.walnut
      : theme.faint;
}

/** Rows shown per panel. Three panels have to share one 24-row terminal. */
const PANEL_ROWS = 5;

function Panel({
  label,
  rows,
  active,
  index,
  empty,
}: {
  label: string;
  rows: Friend[];
  active: boolean;
  index: number;
  empty: string;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text fg={active ? theme.gold : theme.faint}>
        {`${label} (${rows.length})`}
      </text>

      {rows.length === 0 ? (
        <text fg={theme.faint}>{empty}</text>
      ) : (
        rows.slice(0, PANEL_ROWS).map((friend, i) => {
          const highlighted = active && i === Math.min(index, rows.length - 1);
          const name = friend.title
            ? `${friend.title} ${friend.username}`
            : friend.username;

          return (
            <text
              key={friend.id}
              bg={highlighted ? theme.selectionBg : undefined}
            >
              <span fg={highlighted ? theme.gold : theme.faint}>
                {highlighted ? "▸ " : "  "}
              </span>
              <span fg={presenceColor(friend.presence.state, theme)}>
                {`${PRESENCE_MARK[friend.presence.state]} `}
              </span>
              <span fg={highlighted ? theme.cream : theme.text}>
                {fit(name, NAME_W)}
              </span>
              <span fg={theme.dim}>
                {lastSeenLabel(friend.presence).padEnd(PRESENCE_W)}
              </span>
              <span fg={theme.faint}>{String(friend.rating)}</span>
            </text>
          );
        })
      )}

      {rows.length > PANEL_ROWS ? (
        <text fg={theme.faint}>{`  …and ${rows.length - PANEL_ROWS} more`}</text>
      ) : null}
    </box>
  );
}

/** Trim an over-long name rather than let it push the columns apart. */
function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

/**
 * Find somebody and ask them.
 *
 * The search runs as you type rather than on a submit key, because the whole
 * point is to answer "did I spell it right" before the request is sent — and
 * an exact name typed in full still works without ever looking at the results.
 */
function AddFriend({
  onDone,
  onCancel,
}: {
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(SEARCH_KEYMAP);

  const inputRef = useRef<InputRenderable>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim() === "") {
      setResults([]);
      return;
    }

    let cancelled = false;

    void searchPlayers(query)
      .then((players) => {
        if (!cancelled) {
          setResults(players);
          setIndex(0);
        }
      })
      // A failed search is not worth an error box over an input the player is
      // still typing into; the next keystroke tries again.
      .catch(() => {
        if (!cancelled) {
          setResults([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const send = useCallback(async () => {
    // The highlighted result if there is one, otherwise whatever was typed —
    // so a name entered in full does not need the list to have caught up.
    const username = results[index]?.username ?? query.trim();

    if (username === "") {
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      const friend = await addFriend(username);

      onDone(
        // An accepted row means they had already asked us; saying "request
        // sent" there would be wrong in a way the player would notice.
        friend.status === "ACCEPTED"
          ? `${friend.username} had already asked — you're friends.`
          : `Asked ${friend.username}.`,
      );
    } catch (cause) {
      setMessage(errorMessage(cause));
      setPending(false);
    }
  }, [index, onDone, query, results]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || pending) {
      return;
    }

    // The input has focus and swallows printable keys, so what is left here are
    // the ones a text field never sees.
    if (key.name === "return" || key.name === "enter") {
      void send();
      return;
    }
    if (key.name === "up") {
      setIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (key.name === "down") {
      setIndex((value) => Math.min(results.length - 1, value + 1));
    }
  });

  return (
    <GameScreen
      title="Add a friend"
      subtitle="Type a name; matches appear as you go"
      width={WIDTH}
      onEscape={() => {
        onCancel();
        return true;
      }}
    >
      <box flexDirection="column" width={WIDTH - 6} gap={1}>
        <input
          ref={inputRef}
          placeholder="username"
          focused
          onContentChange={() => setQuery(inputRef.current?.value ?? "")}
        />

        <box flexDirection="column">
          {results.length === 0 ? (
            <text fg={theme.faint}>
              {query.trim() === "" ? " " : "No player by that name."}
            </text>
          ) : (
            results.map((player, i) => {
              const highlighted = i === index;

              return (
                <text
                  key={player.userId}
                  bg={highlighted ? theme.selectionBg : undefined}
                >
                  <span fg={highlighted ? theme.gold : theme.faint}>
                    {highlighted ? "▸ " : "  "}
                  </span>
                  <span fg={presenceColor(player.presence.state, theme)}>
                    {`${PRESENCE_MARK[player.presence.state]} `}
                  </span>
                  <span fg={highlighted ? theme.cream : theme.text}>
                    {fit(player.username, NAME_W)}
                  </span>
                  <span fg={theme.dim}>
                    {String(player.rating).padEnd(PRESENCE_W)}
                  </span>
                  {/* Saying where you already stand is what stops the player
                      asking someone they have already asked. */}
                  <span fg={theme.faint}>
                    {player.friendship === "friends"
                      ? "already friends"
                      : player.friendship === "requestSent"
                        ? "asked"
                        : player.friendship === "requestReceived"
                          ? "asked you"
                          : ""}
                  </span>
                </text>
              );
            })
          )}
        </box>

        {message ? <text fg={theme.gold}>{message}</text> : null}
        {pending ? <text fg={theme.dim}>Sending…</text> : null}
      </box>

      <HintBar
        hints={[
          { key: "↑↓", label: "pick" },
          { key: "enter", label: "ask" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </GameScreen>
  );
}
