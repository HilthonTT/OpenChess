import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  findKing,
  findUciMove,
  fromAlgebraic,
  play,
  toUci,
  type Color,
  type Game,
  type Move,
  type PromotionPiece,
} from "@openchess/shared";
import { Board } from "../components/board";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { MoveList, PromotionPrompt } from "../components/game-panels";
import {
  fetchDailyPuzzle,
  fetchNextPuzzle,
  fetchPuzzleHint,
  revealPuzzle,
  sendPuzzleMove,
  type NextPuzzle,
  type PuzzleMoveResult,
  type ServerPuzzle,
} from "../lib/puzzles";
import { errorMessage } from "../lib/utils";
import { homeSquare, useBoardCursor } from "../hooks/use-board-cursor";
import { useGameKeys } from "../hooks/use-game-keys";
import { useMoveSelection } from "../hooks/use-move-selection";
import { useAuth } from "../providers/auth";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";

const TITLE = "Puzzles";
const SUBTITLE = "Find the move the position is asking for";
const WIDTH = 58;

/**
 * The tactics trainer.
 *
 * The line is never sent to this screen — that is the whole design. Each move
 * goes to the server, which replays the attempt and answers "right, and here is
 * the reply" or "wrong, and here is the answer". So the board here is rebuilt
 * from the position and the moves that have actually landed, not from a
 * solution it is holding and pretending not to look at.
 */
export function Puzzles() {
  const auth = useAuth();
  const theme = useUITheme();

  const [mode, setMode] = useState<"rated" | "daily">("rated");
  const [state, setState] = useState<NextPuzzle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (auth.status !== "signed-in") {
      return;
    }

    let cancelled = false;
    setError(null);
    setState(null);

    const load = mode === "daily" ? fetchDailyPuzzle : fetchNextPuzzle;

    void load()
      .then((next) => {
        if (!cancelled) {
          setState(next);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [attempt, auth.status, mode]);

  const advance = useCallback(() => setAttempt((value) => value + 1), []);

  const toggleDaily = useCallback(() => {
    setMode((value) => (value === "daily" ? "rated" : "daily"));
  }, []);

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
          <text fg={theme.gold}>Puzzles need an account</text>
          <text fg={theme.dim}>
            Your puzzle rating and streak live on the server; sign in to start.
          </text>
        </box>
      </GameScreen>
    );
  }

  if (error) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <ErrorNotice title="Couldn't load a puzzle" message={error} />
      </GameScreen>
    );
  }

  if (!state) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <text fg={theme.dim}>Finding a puzzle…</text>
      </GameScreen>
    );
  }

  if (!state.puzzle) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.gold}>You've solved everything we have</text>
          <text fg={theme.dim}>
            Import more with `bun run db:import-puzzles`, or come back after the
            next seed.
          </text>
        </box>
      </GameScreen>
    );
  }

  return (
    <PuzzleBoard
      key={state.puzzle.id}
      puzzle={state.puzzle}
      rating={state.rating}
      streak={state.streak}
      daily={mode === "daily"}
      onNext={advance}
      onToggleDaily={toggleDaily}
    />
  );
}

/** What the screen is showing right now, which decides the whole footer. */
type Phase = "solving" | "solved" | "failed";

/** Null when the puzzle had already been attempted, so nothing was owed. */
type PuzzleRewards = PuzzleMoveResult["rewards"];

function PuzzleBoard({
  puzzle,
  rating,
  streak,
  daily,
  onNext,
  onToggleDaily,
}: {
  puzzle: ServerPuzzle;
  rating: number;
  streak: number;
  daily: boolean;
  onNext: () => void;
  onToggleDaily: () => void;
}) {
  const theme = useUITheme();
  const toast = useToast();
  const auth = useAuth();

  /**
   * The board, rebuilt from the puzzle's position plus every move the server
   * has confirmed. Kept as UCI rather than as a `Game` so that "what has
   * landed" and "what is on screen" cannot drift apart: the game is derived.
   */
  const [line, setLine] = useState<string[]>(() => [puzzle.openingMove]);
  /** Only our own moves, which is what the server wants sent back. */
  const [ourMoves, setOurMoves] = useState<string[]>([]);

  const [phase, setPhase] = useState<Phase>("solving");
  const [pending, setPending] = useState(false);
  const [solution, setSolution] = useState<string[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ratingNow, setRatingNow] = useState(rating);
  const [streakNow, setStreakNow] = useState(streak);

  const startedAt = useRef(Date.now());

  const game = useMemo(() => replayLine(puzzle.fen, line), [puzzle.fen, line]);
  const you: Color = useMemo(
    () => replayLine(puzzle.fen, [puzzle.openingMove]).position.turn,
    [puzzle.fen, puzzle.openingMove],
  );

  const cursor = useBoardCursor({
    initialSquare: homeSquare(you),
    initiallyFlipped: you === "b",
  });

  const over = phase !== "solving";

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "This puzzle is done — press n for the next one",
    you: { color: you, waitMessage: "Wait for the reply…" },
    locked: pending,
  });
  const { beginCommit, setMessage } = selection;

  /** Bank a solve: the header numbers, the toasts, and the wallet refresh. */
  const announce = useCallback(
    (rewards: PuzzleRewards) => {
      if (!rewards) {
        setNote("Solved — you'd already been scored on this one");
        return;
      }

      setRatingNow(rewards.ratingAfter);
      setStreakNow(rewards.streak);

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
    },
    [auth, toast],
  );

  /** Send a move and fold whatever comes back into the board. */
  const commit = useCallback(
    async (from: number, to: number, choice?: PromotionPiece) => {
      const move = beginCommit(from, to, choice);
      if (!move) {
        return;
      }

      const uci = toUci(move);
      const moves = [...ourMoves, uci];

      setPending(true);
      setNote(null);

      try {
        const result = await sendPuzzleMove(puzzle.id, {
          moves,
          msSpent: Date.now() - startedAt.current,
        });

        setOurMoves(moves);

        if (result.outcome === "continue") {
          // Our move and the reply the line forces, in the order they happened.
          setLine((current) => [...current, uci, result.reply ?? ""]);
          setNote("Right — keep going");
          return;
        }

        setLine((current) => [...current, uci]);
        setSolution(result.solution);

        if (result.outcome === "solved") {
          setPhase("solved");
          announce(result.rewards);
        } else {
          setPhase("failed");
          setNote(
            result.expected
              ? `Not quite — ${result.expected} was the move`
              : "Not quite",
          );
          if (result.rewards) {
            setRatingNow(result.rewards.ratingAfter);
            setStreakNow(result.rewards.streak);
          }
        }
      } catch (error) {
        setMessage(errorMessage(error));
      } finally {
        setPending(false);
      }

    },
    [announce, beginCommit, ourMoves, puzzle.id, setMessage],
  );

  /**
   * The hint moves the cursor onto the piece that has the move. In a terminal
   * that is a better hint than a highlight would be: it points *and* leaves the
   * player one keypress from picking the piece up.
   */
  const takeHint = useCallback(async () => {
    if (over || pending) {
      return;
    }

    setPending(true);
    try {
      const { square } = await fetchPuzzleHint(puzzle.id, ourMoves);
      const index = fromAlgebraic(square);
      if (index !== null) {
        cursor.placeCursor(index);
      }
      setNote(`Look at ${square} — a hinted solve is worth half`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [cursor, over, ourMoves, pending, puzzle.id, setMessage]);

  const giveUp = useCallback(async () => {
    if (over || pending) {
      return;
    }

    setPending(true);
    try {
      const result = await revealPuzzle(puzzle.id, ourMoves);
      // The whole line from the start, so the board can walk to the finish.
      setLine(result.line);
      setSolution(result.solution);
      setPhase("failed");
      setStreakNow(0);
      setNote("The answer, played out");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [over, ourMoves, pending, puzzle.id, setMessage]);

  useGameKeys({
    selection,
    cursor,
    commit,
    onKey: (name) => {
      switch (name) {
        case "n":
          if (!pending) {
            onNext();
          }
          break;
        // `h` is cursor-left on every board screen in the app, so the hint
        // takes its own key rather than shadowing it here alone.
        case "t":
          void takeHint();
          break;
        case "s":
          void giveUp();
          break;
        case "d":
          if (!pending) {
            onToggleDaily();
          }
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
    if (note) {
      return note;
    }
    if (phase === "solved") {
      return "Solved — press n for the next one";
    }
    if (phase === "failed") {
      return "Press n for the next one";
    }
    return you === "w" ? "White to play and win" : "Black to play and win";
  };

  return (
    <GameScreen
      title={`${TITLE}${daily ? " · Daily" : ""}`}
      subtitle={`Rated ${puzzle.rating} · ${puzzle.solverMoves} move${
        puzzle.solverMoves === 1 ? "" : "s"
      } to find`}
      width={WIDTH}
      footer={
        <>
          <span fg={theme.cream}>↑↓←→</span>
          <span fg={theme.faint}> move </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> play </span>
          {over ? null : (
            <>
              <span fg={theme.cream}>t</span>
              <span fg={theme.faint}> hint </span>
              <span fg={theme.cream}>s</span>
              <span fg={theme.faint}> solution </span>
            </>
          )}
          <span fg={theme.cream}>n</span>
          <span fg={theme.faint}> next </span>
          <span fg={theme.cream}>d</span>
          <span fg={theme.faint}>{daily ? " rated " : " daily "}</span>
        </>
      }
    >
      <box flexDirection="row" width="100%" justifyContent="space-between">
        <text>
          <span fg={theme.faint}>Your rating </span>
          <span fg={theme.cream}>{String(ratingNow)}</span>
        </text>
        <text>
          <span fg={theme.faint}>Streak </span>
          <span fg={streakNow > 0 ? theme.gold : theme.dim}>
            {String(streakNow)}
          </span>
        </text>
      </box>

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
        <MoveList game={game} />
      </box>

      {selection.promotion ? (
        <PromotionPrompt />
      ) : (
        <text fg={over ? theme.gold : theme.dim}>{status()}</text>
      )}

      {solution ? (
        <text>
          <span fg={theme.faint}>Solution: </span>
          <span fg={theme.walnut}>{solution.join(" ")}</span>
        </text>
      ) : null}

      {puzzle.themes.length > 0 && over ? (
        <text fg={theme.faint}>{puzzle.themes.slice(0, 4).join(" · ")}</text>
      ) : null}
    </GameScreen>
  );
}

/**
 * The board after a list of UCI moves. A move that will not replay stops the
 * walk rather than throwing: the alternative is a crashed screen over a
 * server response we could simply render less of.
 */
function replayLine(fen: string, moves: string[]): Game {
  let game = createGame(fen);

  for (const uci of moves) {
    if (uci === "") {
      continue;
    }
    const move: Move | null = findUciMove(game, uci);
    if (!move) {
      break;
    }
    game = play(game, move);
  }

  return game;
}
