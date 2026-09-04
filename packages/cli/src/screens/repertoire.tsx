import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  createGame,
  playSan,
  toUci,
  type Game,
  type PromotionPiece,
} from "@openchess/shared";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { MatchView } from "../components/match-view";
import { SignedOut } from "../components/signed-out";
import { homeSquare, useBoardCursor } from "../hooks/use-board-cursor";
import { useGameKeys } from "../hooks/use-game-keys";
import { useMoveSelection } from "../hooks/use-move-selection";
import { LIST_KEYS } from "../lib/keymaps";
import {
  fetchRepertoire,
  removeRepertoireLine,
  reviewRepertoireLine,
  type RepertoireLine,
} from "../lib/repertoire";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";

const TITLE = "Repertoire";
const SUBTITLE = "Lines you play, and when to prove it";
const WIDTH = 62;

const VISIBLE = 8;

const REPLY_MS = 400;

const LIST_KEYMAP: Keymap = {
  title: "Repertoire",
  sections: [
    {
      keys: [
        ...LIST_KEYS,
        { keys: "enter", label: "drill the highlighted line" },
        { keys: "d", label: "drill the next line that is due" },
        { keys: "x", label: "drop a line — pressed twice to confirm" },
        { keys: "r", label: "refresh" },
      ],
    },
    {
      title: "Adding lines",
      keys: [
        { keys: "", label: "lines are added from the Opening Explorer" },
        { keys: "", label: "walk to a position there, then a or shift+a" },
      ],
    },
  ],
};

const DRILL_KEYMAP: Keymap = {
  title: "Repertoire — drilling",
  escape: "back to the list",
  sections: [
    {
      title: "At the board",
      keys: [
        { keys: "↑↓←→ / hjkl", label: "move the cursor" },
        { keys: "enter / space", label: "pick a piece up, and put it down" },
        { keys: "f", label: "flip the board" },
      ],
    },
    {
      title: "The drill",
      keys: [
        { keys: "", label: "play your side's moves; the other side answers" },
        {
          keys: "",
          label: "a wrong move is played correctly for you, and counted",
        },
        { keys: "s", label: "give up on the line and see it played out" },
      ],
    },
  ],
};

export function Repertoire() {
  const auth = useAuth();
  const [drilling, setDrilling] = useState<RepertoireLine | null>(null);

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <SignedOut
          title="A repertoire needs an account"
          message="The server keeps your lines and decides when each falls due."
        />
      </GameScreen>
    );
  }

  return drilling ? (
    <Drill line={drilling} onDone={() => setDrilling(null)} />
  ) : (
    <LineList onDrill={setDrilling} />
  );
}

function LineList({ onDrill }: { onDrill: (line: RepertoireLine) => void }) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(LIST_KEYMAP);

  const [lines, setLines] = useState<RepertoireLine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [confirmingDrop, setConfirmingDrop] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchRepertoire()
      .then((result) => {
        if (!cancelled) {
          setLines(result);
          setCursor((current) =>
            Math.min(current, Math.max(0, result.length - 1)),
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
  }, [attempt]);

  const last = Math.max(0, (lines?.length ?? 0) - 1);
  const selected = lines?.[cursor] ?? null;

  const drop = useCallback(async () => {
    if (!selected) {
      return;
    }

    setConfirmingDrop(false);
    setNote(null);

    try {
      await removeRepertoireLine(selected.id);
      setNote(`Dropped ${selected.name}`);
      setAttempt((value) => value + 1);
    } catch (cause) {
      setNote(errorMessage(cause));
    }
  }, [selected]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (confirmingDrop && key.name !== "x") {
      setConfirmingDrop(false);
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
      case "x":
        if (!selected) {
          break;
        }
        if (confirmingDrop) {
          void drop();
        } else {
          setConfirmingDrop(true);
        }
        break;
      case "d": {
        const due = lines?.find((line) => line.due);

        if (due) {
          onDrill(due);
        } else {
          setNote("Nothing is due. Press enter to drill a line anyway.");
        }
        break;
      }
      case "return":
      case "space":
        if (selected) {
          onDrill(selected);
        }
        break;
    }
  });

  const due = lines?.filter((line) => line.due).length ?? 0;

  return (
    <GameScreen
      title={TITLE}
      subtitle={
        lines === null
          ? SUBTITLE
          : lines.length === 0
            ? SUBTITLE
            : `${lines.length} line${lines.length === 1 ? "" : "s"} · ${
                due === 0 ? "none due" : `${due} due`
              }`
      }
      width={WIDTH}
      footer={
        <>
          <span fg={theme.cream}>↑↓</span>
          <span fg={theme.faint}> browse </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> drill </span>
          <span fg={theme.cream}>d</span>
          <span fg={theme.faint}> next due </span>
          <span fg={theme.cream}>x</span>
          <span fg={theme.faint}> drop </span>
          <span fg={theme.cream}>r</span>
          <span fg={theme.faint}> refresh </span>
        </>
      }
    >
      {error ? (
        <ErrorNotice title="Couldn't load your repertoire" message={error} />
      ) : lines === null ? (
        <text fg={theme.dim}>Loading…</text>
      ) : lines.length === 0 ? (
        <Empty />
      ) : (
        <>
          <List lines={lines} cursor={cursor} loading={loading} />
          <Details
            line={selected}
            note={
              confirmingDrop && selected
                ? `Drop ${selected.name}? Press x again to confirm`
                : note
            }
          />
        </>
      )}

      <HintBar
        hints={[
          { key: "enter", label: "drill" },
          { key: "d", label: "next due" },
          { key: "r", label: "refresh" },
        ]}
      />
    </GameScreen>
  );
}

function Empty() {
  const theme = useUITheme();

  return (
    <box flexDirection="column">
      <text fg={theme.dim}>Nothing in your repertoire yet.</text>
      <text fg={theme.faint}>
        Open the Opening Explorer, walk to a line you play, and press
      </text>
      <text fg={theme.faint}>
        a to keep it as White or shift+a as Black. It shows up here, due now.
      </text>
    </box>
  );
}

const ECO_W = 5;
const NAME_W = 30;
const SIDE_W = 7;
const DUE_W = 10;

function fit(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}…`
    : value.padEnd(width);
}

function dueIn(dueAt: string, now: number): string {
  const ms = new Date(dueAt).getTime() - now;

  if (ms <= 0) {
    return "now";
  }

  const hours = ms / 3_600_000;

  if (hours < 1) {
    return `${Math.max(1, Math.round(ms / 60_000))}m`;
  }
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }

  return `${Math.round(hours / 24)}d`;
}

function List({
  lines,
  cursor,
  loading,
}: {
  lines: RepertoireLine[];
  cursor: number;
  loading: boolean;
}) {
  const theme = useUITheme();
  const now = Date.now();

  const offset = Math.max(
    0,
    Math.min(cursor - Math.floor(VISIBLE / 2), lines.length - VISIBLE),
  );
  const visible = lines.slice(offset, offset + VISIBLE);
  const below = lines.length - offset - VISIBLE;

  const heading = (label: string, width: number, right = false) => (
    <span fg={theme.faint}>
      {right ? label.padStart(width) : label.padEnd(width)}
    </span>
  );

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        {heading("ECO", ECO_W)}
        {heading("Line", NAME_W)}
        {heading("As", SIDE_W)}
        {heading("Due", DUE_W, true)}
      </text>

      {visible.map((line, index) => (
        <Row
          key={line.id}
          line={line}
          selected={offset + index === cursor}
          dimmed={loading}
          now={now}
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
  line,
  selected,
  dimmed,
  now,
}: {
  line: RepertoireLine;
  selected: boolean;
  dimmed: boolean;
  now: number;
}) {
  const theme = useUITheme();

  const name = dimmed ? theme.faint : line.due ? theme.cream : theme.text;

  return (
    <text bg={selected ? theme.selectionBg : undefined}>
      <span fg={theme.faint}>{fit(line.eco, ECO_W)}</span>
      <span fg={name}>{fit(line.name, NAME_W)}</span>
      <span fg={dimmed ? theme.faint : theme.dim}>
        {fit(line.side === "w" ? "White" : "Black", SIDE_W)}
      </span>
      <span fg={line.due && !dimmed ? theme.gold : theme.faint}>
        {dueIn(line.dueAt, now).padStart(DUE_W)}
      </span>
    </text>
  );
}

function Details({
  line,
  note,
}: {
  line: RepertoireLine | null;
  note: string | null;
}) {
  const theme = useUITheme();

  if (!line) {
    return null;
  }

  const moves = line.moves
    .map((san, index) => (index % 2 === 0 ? `${index / 2 + 1}.${san}` : san))
    .join(" ");

  const record =
    line.reviews === 0
      ? "Never drilled"
      : `${line.reviews} review${line.reviews === 1 ? "" : "s"} · ${
          line.streak
        } clean in a row${line.lapses > 0 ? ` · ${line.lapses} lapsed` : ""}`;

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text fg={theme.dim}>{fit(moves, WIDTH - 6)}</text>
      <text fg={theme.faint}>{record}</text>
      {note ? <text fg={theme.gold}>{note}</text> : null}
    </box>
  );
}

type DrillPhase =
  | { kind: "asking" }
  | { kind: "replying" }
  | { kind: "done"; message: string };

function positionAt(moves: string[], ply: number): Game {
  let game = createGame();

  for (let i = 0; i < ply; i += 1) {
    game = playSan(game, moves[i]!);
  }

  return game;
}

function Drill({ line, onDone }: { line: RepertoireLine; onDone: () => void }) {
  const theme = useUITheme();
  const toast = useToast();

  useKeymap(DRILL_KEYMAP);

  const you = line.side;

  const [ply, setPly] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [phase, setPhase] = useState<DrillPhase>({ kind: "asking" });
  const [remark, setRemark] = useState<string | null>(null);

  const startedAt = useRef(Date.now());
  const submitted = useRef(false);

  const game = useMemo(() => positionAt(line.moves, ply), [line.moves, ply]);

  const cursor = useBoardCursor({
    initialSquare: homeSquare(you),
    initiallyFlipped: you === "b",
  });

  const finished = ply >= line.moves.length;
  const yourTurn = !finished && game.position.turn === you;

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over: finished,
    overMessage: "The line is done — press escape for the list",
    you: { color: you, waitMessage: "Playing the reply…" },
    locked: phase.kind !== "asking" || !yourTurn,
  });
  const { beginCommit, clearSelection } = selection;

  const submit = useCallback(
    async (wrong: number) => {
      if (submitted.current) {
        return;
      }
      submitted.current = true;

      setPhase({ kind: "done", message: "Saving…" });

      try {
        const result = await reviewRepertoireLine(line.id, {
          mistakes: wrong,
          msSpent: Date.now() - startedAt.current,
        });

        const days = result.line.intervalDays;
        const when =
          days === 0
            ? "again today"
            : days === 1
              ? "again tomorrow"
              : `again in ${days} days`;

        setPhase({
          kind: "done",
          message:
            wrong === 0
              ? `Clean — ${when}. Escape for the list.`
              : `${wrong} wrong — ${when}. Escape for the list.`,
        });

        if (result.reward) {
          toast.show({
            message: `+${result.reward.xp} xp`,
            variant: "success",
          });

          if (result.reward.levelAfter > result.reward.levelBefore) {
            toast.show({
              message: `Level up! You reached level ${result.reward.levelAfter}.`,
              variant: "success",
            });
          }
        }
      } catch (cause) {
        setPhase({ kind: "done", message: errorMessage(cause) });
      }
    },
    [line.id, toast],
  );

  const advance = useCallback(
    (atPly: number, wrong: number) => {
      const next = atPly + 1;
      setPly(next);
      clearSelection();

      if (next >= line.moves.length) {
        void submit(wrong);
        return;
      }

      const mover = next % 2 === 0 ? "w" : "b";
      setPhase(mover === you ? { kind: "asking" } : { kind: "replying" });
    },
    [clearSelection, line.moves.length, submit, you],
  );

  useEffect(() => {
    if (phase.kind !== "replying") {
      return;
    }

    const timer = setTimeout(() => advance(ply, mistakes), REPLY_MS);

    return () => clearTimeout(timer);
  }, [advance, mistakes, phase.kind, ply]);

  useEffect(() => {
    if (phase.kind === "asking" && !finished && !yourTurn) {
      setPhase({ kind: "replying" });
    }
  }, [finished, phase.kind, yourTurn]);

  const commit = useCallback(
    (from: number, to: number, choice?: PromotionPiece) => {
      const played = beginCommit(from, to, choice);

      if (!played) {
        return;
      }

      const expectedSan = line.moves[ply]!;
      const expected = playSan(game, expectedSan).history.at(-1)?.move ?? null;

      const right = expected !== null && toUci(played) === toUci(expected);

      if (right) {
        setRemark(null);
        advance(ply, mistakes);
        return;
      }

      const wrong = mistakes + 1;
      setMistakes(wrong);
      setRemark(`No — it's ${expectedSan}`);
      advance(ply, wrong);
    },
    [advance, beginCommit, game, line.moves, mistakes, ply],
  );

  const surrender = useCallback(() => {
    const remaining = line.moves.length - ply;

    if (remaining <= 0) {
      return;
    }

    setPly(line.moves.length);
    setRemark(null);
    void submit(mistakes + 1);
  }, [line.moves.length, mistakes, ply, submit]);

  const handleEscape = useCallback(() => {
    onDone();
    return true;
  }, [onDone]);

  useGameKeys({
    selection,
    cursor,
    commit,
    onKey: (name) => {
      if (name === "s" && phase.kind !== "done") {
        surrender();
      }
    },
  });

  const statusText = (): string => {
    if (phase.kind === "done") {
      return phase.message;
    }

    if (remark) {
      return remark;
    }

    if (selection.message) {
      return selection.message;
    }

    if (phase.kind === "replying") {
      return "…";
    }

    const move = Math.floor(ply / 2) + 1;
    return `Your move — ${move}${you === "w" ? "." : "..."}?`;
  };

  return (
    <GameScreen
      title={`${TITLE} · ${line.name}`}
      subtitle={`${line.eco} · as ${you === "w" ? "White" : "Black"} · ${
        line.yourMoves
      } move${line.yourMoves === 1 ? "" : "s"} to find`}
      width={WIDTH}
      onEscape={handleEscape}
      footer={
        <>
          <span fg={theme.cream}>↑↓←→</span>
          <span fg={theme.faint}> move </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> play </span>
          {phase.kind === "done" ? null : (
            <>
              <span fg={theme.cream}>s</span>
              <span fg={theme.faint}> show me </span>
            </>
          )}
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
          <span fg={theme.cream}>esc</span>
          <span fg={theme.faint}> list </span>
        </>
      }
    >
      <MatchView
        game={game}
        cursor={cursor.cursor}
        selected={selection.selected}
        targets={selection.targets}
        flipped={cursor.flipped}
        promotion={selection.promotion !== null}
        over={phase.kind === "done"}
        statusText={statusText()}
      />

      <text fg={mistakes > 0 ? theme.walnut : theme.faint}>
        {mistakes === 0
          ? `${Math.min(ply, line.moves.length)}/${line.moves.length} played`
          : `${Math.min(ply, line.moves.length)}/${line.moves.length} played · ${mistakes} wrong`}
      </text>
    </GameScreen>
  );
}
