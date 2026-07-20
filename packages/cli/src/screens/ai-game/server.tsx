import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { isGameOver, toAlgebraic } from "@openchess/shared";
import type { Color, Difficulty, PromotionPiece } from "@openchess/shared";
import { GameScreen } from "../../components/game-screen";
import { MatchView } from "../../components/match-view";
import {
  GameConflictError,
  abortGame,
  createAiGame,
  fetchActiveAiGame,
  fetchGame,
  resignGame,
  sendMove,
  toEngineDifficulty,
  toServerDifficulty,
  type ServerGame,
} from "../../lib/games";
import { useAuth } from "../../providers/auth";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { useUITheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";
import { homeSquare, useBoardCursor } from "../../hooks/use-board-cursor";
import { useGameKeys } from "../../hooks/use-game-keys";
import { useMoveSelection } from "../../hooks/use-move-selection";
import { useReplayedGame } from "../../hooks/use-replayed-game";
import { DIFFICULTY_LABELS, Setup, describeAiStatus } from "./setup";
import { LocalAIGame } from "./local";
import { errorMessage } from "../../lib/utils";

type Phase =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "creating" }
  | { kind: "error"; message: string }
  | { kind: "playing"; game: ServerGame };

/**
 * Play vs AI, hosted by the server: the game is persisted, the bot answers in
 * the move response, and a finished game pays out XP, coins and rating.
 */
export function ServerAIGame() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [offline, setOffline] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  /** Bumped to run the resume lookup again after an error. */
  const [attempt, setAttempt] = useState(0);

  // An unfinished game on the server is yours to finish, not to strand: resume
  // the newest one instead of quietly opening another.
  useEffect(() => {
    if (offline) {
      return;
    }

    let cancelled = false;
    setPhase({ kind: "loading" });

    void (async () => {
      try {
        const active = await fetchActiveAiGame();
        if (cancelled) {
          return;
        }

        if (!active) {
          setPhase({ kind: "setup" });
          return;
        }

        const game = await fetchGame(active.id);
        if (!cancelled) {
          setPhase({ kind: "playing", game });
        }
      } catch (error) {
        if (!cancelled) {
          setPhase({ kind: "error", message: errorMessage(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt, offline]);

  const start = useCallback((chosen: Difficulty, color: Color) => {
    setPhase({ kind: "creating" });

    void createAiGame({
      difficulty: toServerDifficulty(chosen),
      color: color === "w" ? "white" : "black",
    })
      .then((game) => setPhase({ kind: "playing", game }))
      .catch((error) =>
        setPhase({ kind: "error", message: errorMessage(error) }),
      );
  }, []);

  if (offline) {
    return <LocalAIGame subtitle="Offline play — nothing will be saved" />;
  }

  switch (phase.kind) {
    case "loading":
      return <Waiting text="Looking for a game to resume…" />;
    case "creating":
      return <Waiting text="Starting your game…" />;
    case "setup":
      return (
        <Setup
          difficulty={difficulty}
          onDifficulty={setDifficulty}
          onColor={(color) => difficulty && start(difficulty, color)}
        />
      );
    case "error":
      return (
        <ErrorScreen
          message={phase.message}
          onRetry={() => setAttempt((value) => value + 1)}
          onOffline={() => setOffline(true)}
        />
      );
    case "playing":
      return <ServerMatch key={phase.game.id} initial={phase.game} />;
  }
}

function Waiting({ text }: { text: string }) {
  const theme = useUITheme();

  return (
    <GameScreen
      title="Play vs AI"
      subtitle="Test your skill against the engine"
    >
      <text fg={theme.dim}>{text}</text>
    </GameScreen>
  );
}

function ErrorScreen({
  message,
  onRetry,
  onOffline,
}: {
  message: string;
  onRetry: () => void;
  onOffline: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (key.name === "r") {
      onRetry();
    }
    if (key.name === "o") {
      onOffline();
    }
  });

  return (
    <GameScreen
      title="Play vs AI"
      subtitle="Test your skill against the engine"
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.gold}>Couldn't reach the server</text>
        <text fg={theme.dim}>{message}</text>
        <text>
          <span fg={theme.cream}>r</span>
          <span fg={theme.faint}> retry </span>
          <span fg={theme.cream}>o</span>
          <span fg={theme.faint}> play offline</span>
        </text>
      </box>
    </GameScreen>
  );
}

function ServerMatch({ initial }: { initial: ServerGame }) {
  const theme = useUITheme();
  const toast = useToast();
  const auth = useAuth();

  const [server, setServer] = useState(initial);
  const human = server.yourColor;

  const cursor = useBoardCursor({
    initialSquare: homeSquare(human),
    initiallyFlipped: human === "b",
  });
  /** A request is on the wire; the board is read-only until it answers. */
  const [pending, setPending] = useState(false);
  const [confirmingResign, setConfirmingResign] = useState(false);

  const game = useReplayedGame(server.history);
  const { position, status } = game;
  const over = server.result !== null || isGameOver(status);

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The game is over — press r to play again",
    you: { color: human, waitMessage: "The engine is thinking…" },
    locked: pending,
  });
  const { beginCommit, clearSelection, setMessage } = selection;

  const apply = useCallback(
    (state: ServerGame) => {
      setServer(state);
      clearSelection();

      const rewards = state.rewards;
      if (!rewards) {
        return;
      }

      // The header shows level and coins off the cached profile; the payout
      // just changed both.
      void auth.refresh();

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
    },
    [auth, clearSelection, toast],
  );

  /** Refetch and accept whatever the server says; our picture was stale. */
  const resync = useCallback(async () => {
    try {
      apply(await fetchGame(server.id));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [apply, server.id, setMessage]);

  const commit = useCallback(
    async (from: number, to: number, choice?: PromotionPiece) => {
      if (!beginCommit(from, to, choice)) {
        return;
      }

      setPending(true);

      try {
        const result = await sendMove(server.id, {
          from: toAlgebraic(from),
          to: toAlgebraic(to),
          promotion: choice,
          ply: server.ply,
        });
        apply(result.state);
      } catch (error) {
        if (error instanceof GameConflictError) {
          await resync();
        } else {
          setMessage(errorMessage(error));
        }
      } finally {
        setPending(false);
      }
    },
    [apply, beginCommit, resync, server.id, server.ply, setMessage],
  );

  const newGame = useCallback(async () => {
    setPending(true);
    setMessage(null);

    try {
      const created = await createAiGame({
        difficulty: server.difficulty ?? "MEDIUM",
        color: human === "w" ? "white" : "black",
      });
      setServer(created);
      cursor.resetCursor();
      clearSelection();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [clearSelection, cursor.resetCursor, human, server.difficulty, setMessage]);

  /**
   * Give up the game. Before the first move it is an abort — settled with no
   * loss on the record — and once under way it is a resignation.
   */
  const concede = useCallback(async () => {
    setConfirmingResign(false);
    setPending(true);
    setMessage(null);

    try {
      const settled =
        server.ply === 0
          ? await abortGame(server.id)
          : await resignGame(server.id);
      apply(settled);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [apply, server.id, server.ply, setMessage]);

  // Escape's extra step here: a pending resign confirmation. Leaving mid-game
  // is fine — the game stays active and is resumed on return.
  const handleEscape = useCallback(
    () =>
      selection.handleEscape(() => {
        if (confirmingResign) {
          setConfirmingResign(false);
          return true;
        }
        return false;
      }),
    [confirmingResign, selection.handleEscape],
  );

  useGameKeys({
    selection,
    cursor,
    commit,
    // A pending resign is called off by any key that isn't its own confirm.
    before: (name) => {
      if (confirmingResign && name !== "x") {
        setConfirmingResign(false);
      }
    },
    onKey: (name) => {
      switch (name) {
        case "u":
          setMessage("There's no undo in a rated game");
          break;
        case "r":
          if (pending) {
            break;
          }
          if (over) {
            void newGame();
          } else {
            setMessage("Finish the game first — press x to resign");
          }
          break;
        case "x":
          if (pending || over) {
            break;
          }
          if (confirmingResign) {
            void concede();
          } else {
            setConfirmingResign(true);
          }
          break;
      }
    },
  });

  const statusText = (): string => {
    if (pending) {
      return "The engine is thinking…";
    }

    if (confirmingResign) {
      return server.ply === 0
        ? "Abort this game? Press x again to confirm"
        : "Resign this game? Press x again to confirm";
    }

    if (selection.message) {
      return selection.message;
    }

    if (server.result === "ABORTED") {
      return "Game aborted — press r to play again";
    }

    // A result on a position that isn't terminal can only be a resignation.
    if (server.result !== null && !isGameOver(status)) {
      const won = (server.result === "WHITE_WIN") === (human === "w");
      return won
        ? "The engine forfeits — you win!"
        : "You resigned — the engine wins";
    }

    return describeAiStatus(status, position.turn, human);
  };

  const rewards =
    server.result !== null && server.result !== "ABORTED"
      ? server.rewards
      : null;

  return (
    <GameScreen
      title={`Play vs AI · ${
        DIFFICULTY_LABELS[toEngineDifficulty(server.difficulty)]
      }`}
      width={58}
      onEscape={handleEscape}
      footer={
        <>
          <span fg={theme.cream}>↑↓←→</span>
          <span fg={theme.faint}> move </span>
          <span fg={theme.cream}>enter</span>
          <span fg={theme.faint}> select </span>
          <span fg={theme.cream}>x</span>
          <span fg={theme.faint}> resign </span>
          <span fg={theme.cream}>r</span>
          <span fg={theme.faint}> new </span>
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
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
        over={over}
        statusText={statusText()}
      />

      {rewards ? (
        <text>
          <span fg={theme.gold}>{`+${rewards.xp} xp`}</span>
          <span fg={theme.faint}> · </span>
          <span fg={theme.gold}>{`+${rewards.coins} coins`}</span>
          <span fg={theme.faint}> · rating </span>
          <span fg={theme.cream}>
            {`${rewards.ratingBefore} → ${rewards.ratingAfter}`}
          </span>
        </text>
      ) : null}
    </GameScreen>
  );
}
