import { useCallback, useEffect, useRef, useState } from "react";
import { TIME_CONTROLS, type TimeControlKey } from "@openchess/shared";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import {
  acceptChallenge,
  cancelChallenge,
  createChallenge,
  declineChallenge,
  findChallengeByCode,
  listChallenges,
  type ChallengeColor,
  type ServerChallenge,
} from "../lib/challenges";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";

const TITLE = "Challenges";
const SUBTITLE = "Play someone you picked, not whoever's next in line";
const WIDTH = 62;

/**
 * How often the list is refreshed.
 *
 * This is also how a challenger learns their offer was taken: the accepting
 * player creates the game, and the sender's own outgoing row comes back
 * `ACCEPTED` with the game's id on it. There is nothing to push until then, and
 * by then the poll has already asked.
 */
const POLL_MS = 3_000;

export function Challenges() {
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
          <text fg={theme.gold}>Challenges need an account</text>
          <text fg={theme.dim}>
            Sign in from the home screen, then come back.
          </text>
        </box>
      </GameScreen>
    );
  }

  return <ChallengeList />;
}

/** Which panel the cursor is in. */
type Pane = "incoming" | "outgoing";

/** The overlay currently taking keystrokes, if any. */
type Form = null | "new" | "code";

function ChallengeList() {
  const theme = useUITheme();
  const toast = useToast();
  const navigate = useNavigate();
  const { isTopLayer } = useKeyboardLayer();

  const [incoming, setIncoming] = useState<ServerChallenge[]>([]);
  const [outgoing, setOutgoing] = useState<ServerChallenge[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [pane, setPane] = useState<Pane>("incoming");
  const [index, setIndex] = useState(0);
  const [form, setForm] = useState<Form>(null);

  /** Jump into the game a challenge became. */
  const openGame = useCallback(
    (gameId: string) => {
      void navigate("/online", { state: { gameId } });
    },
    [navigate],
  );

  // A challenge of ours that has been accepted is a game waiting to be played,
  // so the poll that finds it takes us straight there rather than leaving the
  // sender staring at a list.
  const acceptedGame = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const lists = await listChallenges();
        if (cancelled) {
          return;
        }

        setIncoming(lists.incoming);
        setOutgoing(lists.outgoing);
        setLoaded(true);
        setError(null);

        const taken = lists.outgoing.find(
          (challenge) =>
            challenge.status === "ACCEPTED" && challenge.gameId !== null,
        );

        if (taken?.gameId && acceptedGame.current !== taken.gameId) {
          acceptedGame.current = taken.gameId;
          toast.show({
            message: `${taken.challenged?.username ?? "Someone"} accepted — opening the board.`,
            variant: "success",
          });
          openGame(taken.gameId);
          return;
        }
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      }

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
  }, [openGame, toast]);

  const rows = pane === "incoming" ? incoming : outgoing;
  const selected = rows[Math.min(index, rows.length - 1)] ?? null;

  const refresh = useCallback(async () => {
    try {
      const lists = await listChallenges();
      setIncoming(lists.incoming);
      setOutgoing(lists.outgoing);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }, []);

  const accept = useCallback(
    async (challenge: ServerChallenge) => {
      setPending(true);
      setNote(null);

      try {
        const game = await acceptChallenge(challenge.id);
        openGame(game.id);
      } catch (cause) {
        setNote(errorMessage(cause));
        await refresh();
      } finally {
        setPending(false);
      }
    },
    [openGame, refresh],
  );

  const answer = useCallback(
    async (challenge: ServerChallenge, action: "decline" | "cancel") => {
      setPending(true);
      setNote(null);

      try {
        if (action === "decline") {
          await declineChallenge(challenge.id);
          setNote("Declined.");
        } else {
          await cancelChallenge(challenge.id);
          setNote("Withdrawn.");
        }
        await refresh();
      } catch (cause) {
        setNote(errorMessage(cause));
      } finally {
        setPending(false);
      }
    },
    [refresh],
  );

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || form !== null || pending) {
      return;
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
      case "left":
      case "right":
        setPane((value) => (value === "incoming" ? "outgoing" : "incoming"));
        setIndex(0);
        break;
      case "return":
      case "space":
        if (selected && pane === "incoming") {
          void accept(selected);
        } else if (selected?.gameId) {
          openGame(selected.gameId);
        }
        break;
      case "d":
        if (selected && pane === "incoming") {
          void answer(selected, "decline");
        }
        break;
      case "x":
        if (selected && pane === "outgoing") {
          void answer(selected, "cancel");
        }
        break;
      case "n":
        setForm("new");
        break;
      case "c":
        setForm("code");
        break;
      case "r":
        void refresh();
        break;
    }
  });

  if (form === "new") {
    return (
      <NewChallenge
        onDone={(message) => {
          setForm(null);
          setNote(message);
          void refresh();
        }}
        onCancel={() => setForm(null)}
      />
    );
  }

  if (form === "code") {
    return (
      <JoinByCode
        onJoined={(gameId) => {
          setForm(null);
          openGame(gameId);
        }}
        onCancel={() => setForm(null)}
        onError={(message) => {
          setForm(null);
          setNote(message);
        }}
      />
    );
  }

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
      {error && !loaded ? (
        <ErrorNotice title="Couldn't load your challenges" message={error} />
      ) : (
        <>
          <Panel
            label="Waiting for you"
            rows={incoming}
            active={pane === "incoming"}
            index={index}
            describe={(challenge) =>
              `${challenge.challenger.username} (${challenge.challenger.rating})`
            }
          />
          <Panel
            label="Sent by you"
            rows={outgoing}
            active={pane === "outgoing"}
            index={index}
            describe={(challenge) =>
              challenge.challenged
                ? challenge.challenged.username
                : `Open · code ${challenge.code}`
            }
          />
        </>
      )}

      {note ? <text fg={theme.gold}>{note}</text> : null}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "←→", label: "switch" },
          { key: "enter", label: pane === "incoming" ? "accept" : "open" },
          { key: pane === "incoming" ? "d" : "x", label: "dismiss" },
          { key: "n", label: "new" },
          { key: "c", label: "code" },
        ]}
      />
    </GameScreen>
  );
}

const WHO_W = 26;
const CLOCK_W = 10;

function clockLabel(challenge: ServerChallenge): string {
  return challenge.timeControl
    ? TIME_CONTROLS[challenge.timeControl].name
    : "Untimed";
}

function colorLabel(color: ChallengeColor): string {
  return color === "RANDOM" ? "any side" : `as ${color.toLowerCase()}`;
}

function Panel({
  label,
  rows,
  active,
  index,
  describe,
}: {
  label: string;
  rows: ServerChallenge[];
  active: boolean;
  index: number;
  describe: (challenge: ServerChallenge) => string;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text fg={active ? theme.gold : theme.faint}>
        {`${label} (${rows.length})`}
      </text>

      {rows.length === 0 ? (
        <text fg={theme.faint}>—</text>
      ) : (
        rows.slice(0, 6).map((challenge, i) => {
          const highlighted = active && i === Math.min(index, rows.length - 1);

          return (
            <text
              key={challenge.id}
              bg={highlighted ? theme.selectionBg : undefined}
            >
              <span fg={highlighted ? theme.gold : theme.faint}>
                {highlighted ? "▸ " : "  "}
              </span>
              <span fg={highlighted ? theme.cream : theme.text}>
                {describe(challenge).slice(0, WHO_W).padEnd(WHO_W)}
              </span>
              <span fg={theme.dim}>
                {clockLabel(challenge).padEnd(CLOCK_W)}
              </span>
              <span fg={theme.faint}>
                {challenge.status === "ACCEPTED"
                  ? "accepted"
                  : colorLabel(challenge.color)}
              </span>
            </text>
          );
        })
      )}
    </box>
  );
}

/** The clocks a challenge can be sent for, in the order they are offered. */
const CLOCK_CHOICES: Array<{ key: string; value: TimeControlKey | null }> = [
  { key: "1", value: null },
  { key: "2", value: "bullet" },
  { key: "3", value: "blitz" },
  { key: "4", value: "rapid" },
];

const COLOR_CYCLE: ChallengeColor[] = ["RANDOM", "WHITE", "BLACK"];

function NewChallenge({
  onDone,
  onCancel,
}: {
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const inputRef = useRef<InputRenderable>(null);
  const [opponent, setOpponent] = useState("");
  const [timeControl, setTimeControl] = useState<TimeControlKey | null>(null);
  const [color, setColor] = useState<ChallengeColor>("RANDOM");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = useCallback(async () => {
    setPending(true);
    setMessage(null);

    try {
      const challenge = await createChallenge({
        opponent: opponent.trim() === "" ? null : opponent.trim(),
        color,
        timeControl,
      });

      onDone(
        challenge.challenged
          ? `Challenge sent to ${challenge.challenged.username}.`
          : `Open challenge created — share the code ${challenge.code}.`,
      );
    } catch (cause) {
      setMessage(errorMessage(cause));
      setPending(false);
    }
  }, [color, onDone, opponent, timeControl]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || pending) {
      return;
    }

    // The input has focus and swallows printable keys, so the controls that
    // remain are the ones a text field never sees.
    if (key.name === "return" || key.name === "enter") {
      void send();
      return;
    }

    if (key.name === "tab") {
      setColor(
        (value) =>
          COLOR_CYCLE[(COLOR_CYCLE.indexOf(value) + 1) % COLOR_CYCLE.length]!,
      );
      return;
    }

    const choice = CLOCK_CHOICES.find((entry) => entry.key === key.name);
    if (choice && key.ctrl) {
      setTimeControl(choice.value);
    }
  });

  return (
    <GameScreen
      title="New challenge"
      subtitle="Leave the name empty for an open challenge anyone can take"
      width={WIDTH}
      onEscape={() => {
        onCancel();
        return true;
      }}
    >
      <box flexDirection="column" width={WIDTH - 6} gap={1}>
        <text fg={theme.faint}>Opponent</text>
        <input
          ref={inputRef}
          placeholder="username, or blank for an open challenge"
          focused
          onContentChange={() => setOpponent(inputRef.current?.value ?? "")}
        />

        <text>
          <span fg={theme.faint}>Clock </span>
          <span fg={theme.cream}>
            {timeControl ? TIME_CONTROLS[timeControl].label : "Untimed"}
          </span>
          <span fg={theme.faint}>
            {"   ctrl+1 untimed · ctrl+2 bullet · ctrl+3 blitz · ctrl+4 rapid"}
          </span>
        </text>

        <text>
          <span fg={theme.faint}>You play </span>
          <span fg={theme.cream}>{colorLabel(color)}</span>
          <span fg={theme.faint}>{"   tab to change"}</span>
        </text>

        {message ? <text fg={theme.gold}>{message}</text> : null}
        {pending ? <text fg={theme.dim}>Sending…</text> : null}
      </box>

      <HintBar
        hints={[
          { key: "enter", label: "send" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </GameScreen>
  );
}

function JoinByCode({
  onJoined,
  onCancel,
  onError,
}: {
  onJoined: (gameId: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const inputRef = useRef<InputRenderable>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const join = useCallback(async () => {
    const typed = code.trim();
    if (typed === "") {
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      // Two steps on purpose: the code names a challenge, and accepting one is
      // the same request whether it was found by code or picked off the list.
      const challenge = await findChallengeByCode(typed);
      const game = await acceptChallenge(challenge.id);
      onJoined(game.id);
    } catch (cause) {
      const text = errorMessage(cause);
      setMessage(text);
      setPending(false);
      onError(text);
    }
  }, [code, onError, onJoined]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || pending) {
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      void join();
    }
  });

  return (
    <GameScreen
      title="Join by code"
      subtitle="The code whoever made the challenge read out to you"
      width={WIDTH}
      onEscape={() => {
        onCancel();
        return true;
      }}
    >
      <box flexDirection="column" width={WIDTH - 6} gap={1}>
        <input
          ref={inputRef}
          placeholder="K7M2QP"
          focused
          onContentChange={() => setCode(inputRef.current?.value ?? "")}
        />
        {message ? <text fg={theme.gold}>{message}</text> : null}
        {pending ? <text fg={theme.dim}>Joining…</text> : null}
      </box>

      <HintBar
        hints={[
          { key: "enter", label: "join" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </GameScreen>
  );
}
