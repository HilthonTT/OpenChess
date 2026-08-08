import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  createGame,
  findKing,
  findUciMove,
  play,
  toUci,
  type Color,
  type Game,
  type PromotionPiece,
} from "@openchess/shared";
import { Board } from "../components/board";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { PromotionPrompt } from "../components/game-panels";
import { SignedOut } from "../components/signed-out";
import {
  endRush,
  fetchRushBests,
  fetchRushLeaderboard,
  RUSH_MODE_LABEL,
  sendRushMove,
  startRush,
  type RushBest,
  type RushLeaderboardEntry,
  type RushMode,
  type RushMoveResult,
  type RushRun,
} from "../lib/puzzles";
import { errorMessage } from "../lib/utils";
import { homeSquare, useBoardCursor } from "../hooks/use-board-cursor";
import { useGameKeys } from "../hooks/use-game-keys";
import { useMoveSelection } from "../hooks/use-move-selection";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { BOARD_KEYS } from "../lib/keymaps";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";

const LOBBY_KEYMAP: Keymap = {
  title: "Puzzle Rush — pick a mode",
  sections: [
    {
      keys: [
        { keys: "←→", label: "browse the modes without starting one" },
        { keys: "1", label: "3 minutes" },
        { keys: "2", label: "5 minutes" },
        { keys: "3", label: "Survival — no clock, three mistakes" },
      ],
    },
  ],
};

const RUN_KEYMAP: Keymap = {
  title: "Puzzle Rush — a run",
  escape: "cancel the selection, then back to the menu",
  sections: [
    { title: "At the board", keys: BOARD_KEYS },
    {
      title: "The run",
      keys: [
        { keys: "x", label: "stop here and bank the score" },
        { keys: "n", label: "another run, once this one is over" },
      ],
    },
    {
      title: "Not during a run",
      keys: [
        { keys: "t s", label: "no hint and no solution — this one is scored" },
      ],
    },
  ],
};

const TITLE = "Puzzle Rush";
const SUBTITLE = "Solve as many as you can before the clock or three mistakes";
const WIDTH = 58;

/**
 * Puzzle Rush.
 *
 * The same never-hold-the-answer protocol the tactics trainer uses: every move
 * goes to the server, which replays it and answers. What is different is that
 * the *run* lives on the server too — the score, the mistakes and the clock are
 * all its, and this screen holds none of them authoritatively. The countdown
 * below is drawn from `endsAt`, not counted down locally, so a paused terminal
 * or a slow network cannot buy anyone a longer run.
 */

const MODES: Array<{
  mode: RushMode;
  key: string;
  label: string;
  blurb: string;
}> = [
  {
    mode: "THREE_MINUTE",
    key: "1",
    label: "3 minutes",
    blurb: "The classic sprint",
  },
  {
    mode: "FIVE_MINUTE",
    key: "2",
    label: "5 minutes",
    blurb: "A little more room",
  },
  {
    mode: "SURVIVAL",
    key: "3",
    label: "Survival",
    blurb: "No clock — three mistakes",
  },
];

export function Rush() {
  const auth = useAuth();

  const [run, setRun] = useState<RushRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const begin = useCallback(async (mode: RushMode) => {
    setStarting(true);
    setError(null);
    try {
      setRun(await startRush(mode));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setStarting(false);
    }
  }, []);

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <SignedOut
          title="Puzzle Rush needs an account"
          message="The clock and the score are the server's."
        />
      </GameScreen>
    );
  }

  if (run === null) {
    return <Lobby onStart={begin} starting={starting} error={error} />;
  }

  return <RunBoard key={run.id} initial={run} onAgain={() => setRun(null)} />;
}

/** Pick a mode, and see what you and everyone else have managed at it. */
function Lobby({
  onStart,
  starting,
  error,
}: {
  onStart: (mode: RushMode) => void;
  starting: boolean;
  error: string | null;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(LOBBY_KEYMAP);

  const [bests, setBests] = useState<RushBest[]>([]);
  const [board, setBoard] = useState<RushLeaderboardEntry[]>([]);
  const [mode, setMode] = useState<RushMode>("THREE_MINUTE");

  useEffect(() => {
    let cancelled = false;
    void fetchRushBests()
      .then((list) => {
        if (!cancelled) setBests(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchRushLeaderboard(mode, 5)
      .then((list) => {
        if (!cancelled) setBoard(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [mode]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || starting) {
      return;
    }

    const picked = MODES.find((entry) => entry.key === key.name);
    if (picked) {
      onStart(picked.mode);
      return;
    }

    // The arrows browse the boards without committing to a run, so you can see
    // what a mode is worth before starting one.
    if (key.name === "left" || key.name === "right") {
      setMode((current) => {
        const index = MODES.findIndex((entry) => entry.mode === current);
        const next =
          key.name === "left"
            ? (index - 1 + MODES.length) % MODES.length
            : (index + 1) % MODES.length;
        return MODES[next]!.mode;
      });
    }
  });

  const bestAt = (target: RushMode) =>
    bests.find((entry) => entry.mode === target);

  return (
    <GameScreen
      title={TITLE}
      subtitle={SUBTITLE}
      width={WIDTH}
      footer={
        <>
          <span fg={theme.cream}>1-3</span>
          <span fg={theme.faint}> start </span>
          <span fg={theme.cream}>←→</span>
          <span fg={theme.faint}> browse </span>
          <span fg={theme.cream}>esc</span>
          <span fg={theme.faint}> back </span>
        </>
      }
    >
      {error ? (
        <ErrorNotice title="Couldn't start a run" message={error} />
      ) : null}

      <box flexDirection="column" gap={0}>
        {MODES.map((entry) => {
          const mine = bestAt(entry.mode);
          const active = entry.mode === mode;

          return (
            <text key={entry.mode}>
              <span fg={theme.cream}>{entry.key}</span>
              <span fg={theme.faint}> </span>
              <span fg={active ? theme.gold : theme.walnut}>
                {entry.label.padEnd(11)}
              </span>
              <span fg={theme.faint}>{entry.blurb.padEnd(24)}</span>
              <span fg={mine && mine.best > 0 ? theme.gold : theme.dim}>
                {mine && mine.best > 0 ? `best ${mine.best}` : "—"}
              </span>
            </text>
          );
        })}
      </box>

      <box flexDirection="column" gap={0}>
        <text fg={theme.walnut}>{`Top runs · ${RUSH_MODE_LABEL[mode]}`}</text>
        {board.length === 0 ? (
          <text fg={theme.dim}>Nobody has posted a score yet. Go first.</text>
        ) : (
          board.map((entry) => (
            <text key={`${entry.rank}-${entry.username}`}>
              <span fg={theme.faint}>{`${entry.rank}`.padStart(2)} </span>
              <span fg={theme.cream}>{entry.username.padEnd(18)}</span>
              <span fg={theme.faint}>{(entry.title ?? "").padEnd(14)}</span>
              <span fg={theme.gold}>{String(entry.solved)}</span>
            </text>
          ))
        )}
      </box>

      {starting ? <text fg={theme.dim}>Starting…</text> : null}
    </GameScreen>
  );
}

/** The board, and the run's numbers above it. */
function RunBoard({
  initial,
  onAgain,
}: {
  initial: RushRun;
  onAgain: () => void;
}) {
  const theme = useUITheme();
  const toast = useToast();
  const auth = useAuth();

  useKeymap(RUN_KEYMAP);

  const [run, setRun] = useState<RushRun | RushMoveResult>(initial);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  /** Our own moves at the current puzzle, which is what the server wants back. */
  const [ourMoves, setOurMoves] = useState<string[]>([]);
  /** The board: the puzzle's position plus every move the server has confirmed. */
  const [line, setLine] = useState<string[]>(() =>
    initial.puzzle ? [initial.puzzle.openingMove] : [],
  );

  const puzzle = run.puzzle;
  const over = run.over;

  const game = useMemo(
    () => (puzzle ? replayLine(puzzle.fen, line) : createGame()),
    [puzzle, line],
  );

  const you: Color = useMemo(
    () =>
      puzzle ? replayLine(puzzle.fen, [puzzle.openingMove]).position.turn : "w",
    [puzzle],
  );

  const cursor = useBoardCursor({
    initialSquare: homeSquare(you),
    initiallyFlipped: you === "b",
  });
  const { placeCursor, resetCursor } = cursor;

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The run is over — press n to go again",
    you: { color: you, waitMessage: "Wait for the reply…" },
    locked: pending,
  });
  const { beginCommit, clearSelection, setMessage } = selection;

  const remaining = useCountdown(run.endsAt, over);

  /** Fold a server response into the screen, resetting the board on a new puzzle. */
  const absorb = useCallback(
    (result: RushMoveResult, previousPuzzleId: string | null) => {
      setRun(result);

      if (result.outcome === "continue") {
        return;
      }

      if (result.puzzle && result.puzzle.id !== previousPuzzleId) {
        // A fresh puzzle: the board starts again from its own opening move.
        setLine([result.puzzle.openingMove]);
        setOurMoves([]);
        clearSelection();
        resetCursor();
      }
    },
    [clearSelection, resetCursor],
  );

  /** Announce a finished run once, when it finishes. */
  const announced = useRef(false);
  useEffect(() => {
    if (!over || announced.current) {
      return;
    }
    announced.current = true;

    const rewards = "rewards" in run ? run.rewards : null;
    if (!rewards) {
      return;
    }

    for (const unlock of rewards.unlocked) {
      toast.show({
        message: `Achievement unlocked: ${unlock.name}`,
        variant: "success",
      });
    }

    if (rewards.levelAfter > rewards.levelBefore) {
      toast.show({
        message: `Level up! You reached level ${rewards.levelAfter}.`,
        variant: "success",
      });
    }

    // The payout moved the header's coins and XP.
    void auth.refresh();
  }, [auth, over, run, toast]);

  const commit = useCallback(
    async (from: number, to: number, choice?: PromotionPiece) => {
      if (!puzzle || over) {
        return;
      }

      const move = beginCommit(from, to, choice);
      if (!move) {
        return;
      }

      const uci = toUci(move);
      const moves = [...ourMoves, uci];

      setPending(true);
      setNote(null);

      try {
        const result = await sendRushMove(run.id, moves);

        if (result.outcome === "continue") {
          setOurMoves(moves);
          setLine((current) => [...current, uci, result.reply ?? ""]);
          setNote("Right — keep going");
          absorb(result, puzzle.id);
          return;
        }

        setNote(
          result.outcome === "solved"
            ? "Solved"
            : `Missed — ${(result.solution ?? []).join(" ")}`,
        );
        absorb(result, puzzle.id);
      } catch (error) {
        setMessage(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [absorb, beginCommit, ourMoves, over, puzzle, run.id, setMessage],
  );

  const stop = useCallback(async () => {
    if (over || pending) {
      return;
    }

    setPending(true);
    try {
      setRun(await endRush(run.id));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [over, pending, run.id, setMessage]);

  // The clock is the server's, so a run can expire with nothing being played.
  // One request when the countdown hits zero settles it and shows the score.
  const settled = useRef(false);
  useEffect(() => {
    if (over || remaining === null || remaining > 0 || settled.current) {
      return;
    }
    settled.current = true;
    void stop();
  }, [over, remaining, stop]);

  useGameKeys({
    selection,
    cursor,
    commit,
    onKey: (name) => {
      switch (name) {
        case "n":
          if (over) {
            onAgain();
          }
          break;
        case "x":
          void stop();
          break;
      }
    },
  });

  const lastMove = game.history[game.history.length - 1]?.move ?? null;
  const checkSquare =
    game.status === "check" || game.status === "checkmate"
      ? findKing(game.position.board, game.position.turn)
      : null;

  const status = (): string => {
    if (pending) {
      return "Checking…";
    }
    if (selection.message) {
      return selection.message;
    }
    if (over) {
      return `Run over — ${run.solved} solved. Press n to go again.`;
    }
    if (note) {
      return note;
    }
    return you === "w" ? "White to play and win" : "Black to play and win";
  };

  const rewards = "rewards" in run ? run.rewards : null;

  return (
    <GameScreen
      title={`${TITLE} · ${RUSH_MODE_LABEL[run.mode]}`}
      subtitle={
        puzzle && !over
          ? `Rated ${puzzle.rating} · ${puzzle.solverMoves} move${
              puzzle.solverMoves === 1 ? "" : "s"
            } to find`
          : SUBTITLE
      }
      width={WIDTH}
      footer={
        <>
          <span fg={theme.cream}>↑↓←→</span>
          <span fg={theme.faint}> move </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> play </span>
          {over ? (
            <>
              <span fg={theme.cream}>n</span>
              <span fg={theme.faint}> again </span>
            </>
          ) : (
            <>
              <span fg={theme.cream}>x</span>
              <span fg={theme.faint}> stop </span>
            </>
          )}
        </>
      }
    >
      <box flexDirection="row" width="100%" justifyContent="space-between">
        <text>
          <span fg={theme.faint}>Score </span>
          <span fg={theme.gold}>{String(run.solved)}</span>
        </text>
        <text>
          <span fg={theme.faint}>Lives </span>
          <span fg={run.livesLeft > 1 ? theme.cream : theme.gold}>
            {"●".repeat(run.livesLeft) + "○".repeat(3 - run.livesLeft)}
          </span>
        </text>
        <text>
          <span fg={theme.faint}>{remaining === null ? "Best " : "Time "}</span>
          <span fg={theme.cream}>
            {remaining === null ? String(run.best) : formatClock(remaining)}
          </span>
        </text>
      </box>

      {puzzle && !over ? (
        <box flexDirection="row" gap={2}>
          <Board
            board={game.position.board}
            cursor={cursor.cursor}
            selected={selection.selected}
            targets={selection.targets}
            lastMove={lastMove}
            checkSquare={checkSquare}
            flipped={cursor.flipped}
          />
        </box>
      ) : null}

      {selection.promotion ? (
        <PromotionPrompt />
      ) : (
        <text fg={over ? theme.gold : theme.dim}>{status()}</text>
      )}

      {over ? (
        <box flexDirection="column" alignItems="center" gap={0}>
          <text>
            <span fg={theme.faint}>Solved </span>
            <span fg={theme.gold}>{String(run.solved)}</span>
            <span fg={theme.faint}> · Missed </span>
            <span fg={theme.cream}>{String(run.missed)}</span>
            <span fg={theme.faint}> · Your best </span>
            <span fg={theme.cream}>{String(run.best)}</span>
          </text>
          {rewards && (rewards.xp > 0 || rewards.coins > 0) ? (
            <text>
              <span fg={theme.faint}>Earned </span>
              <span fg={theme.gold}>{`${rewards.xp} XP`}</span>
              <span fg={theme.faint}> and </span>
              <span fg={theme.gold}>{`${rewards.coins} coins`}</span>
            </text>
          ) : null}
        </box>
      ) : null}
    </GameScreen>
  );
}

/**
 * Milliseconds left on the server's clock, ticking once a second, or null when
 * the run has none.
 *
 * Derived from `endsAt` rather than counted down from a duration: the server
 * decides when a run is over, and a local counter that drifted would either
 * cut a run short or keep showing time that had already gone.
 */
function useCountdown(endsAt: string | null, stopped: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (endsAt === null || stopped) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt, stopped]);

  if (endsAt === null) {
    return null;
  }

  return Math.max(0, new Date(endsAt).getTime() - now);
}

function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * The board after a list of UCI moves. A move that will not replay stops the
 * walk rather than throwing: the alternative is a crashed screen over a server
 * response we could simply render less of.
 */
function replayLine(fen: string, moves: string[]): Game {
  let game = createGame(fen);

  for (const uci of moves) {
    if (uci === "") {
      continue;
    }
    const move = findUciMove(game, uci);
    if (!move) {
      break;
    }
    game = play(game, move);
  }

  return game;
}
