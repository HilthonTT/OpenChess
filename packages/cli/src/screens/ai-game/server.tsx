import { useCallback, useEffect, useState } from "react";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import {
  isGameOver,
  PERSONALITIES,
  timeControlFor,
  toAlgebraic,
} from "@openchess/shared";
import type { PromotionPiece } from "@openchess/shared";
import { ErrorNotice } from "../../components/error-notice";
import { GameScreen } from "../../components/game-screen";
import { MatchView, orientClocks } from "../../components/match-view";
import {
  GameConflictError,
  abortGame,
  createAiGame,
  fetchActiveAiGame,
  fetchGame,
  flagGame,
  offerTakeback,
  resignGame,
  sendMove,
  type ServerGame,
} from "../../lib/games";
import { serverPgnDetails } from "../../lib/copy-game";
import { useAuth } from "../../providers/auth";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { useUITheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";
import { homeSquare, useBoardCursor } from "../../hooks/use-board-cursor";
import { useClock } from "../../hooks/use-clock";
import { useGameKeys } from "../../hooks/use-game-keys";
import { useMoveSelection } from "../../hooks/use-move-selection";
import { useReplayedGame } from "../../hooks/use-replayed-game";
import { useKeymap, type Keymap } from "../../providers/keymap";
import { BOARD_ESCAPE, BOARD_KEYS, COPY_KEYS } from "../../lib/keymaps";
import { Setup, describeAiStatus, type SetupChoice } from "./setup";
import { LocalAIGame } from "./local";
import { errorMessage } from "../../lib/utils";

const MATCH_KEYMAP: Keymap = {
  title: "Play vs AI",
  escape: BOARD_ESCAPE,
  sections: [
    { title: "At the board", keys: BOARD_KEYS },
    {
      title: "The game",
      keys: [
        { keys: "x", label: "resign — pressed twice to confirm" },
        { keys: "r", label: "a new game, once this one is over" },
        {
          keys: "a",
          label: "review the game with the engine, once it is over",
        },
        {
          keys: "u",
          label: "take your move and the bot's reply back — voids the payout",
        },
      ],
    },
    {
      title: "Copy out",
      keys: [
        ...COPY_KEYS,
        { keys: "", label: "both held back until the game is settled" },
      ],
    },
  ],
};

type Phase =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "creating" }
  | { kind: "error"; message: string }
  | { kind: "playing"; game: ServerGame };

export function ServerAIGame() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);

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
  }, [offline, attempt]);

  const start = useCallback((choice: SetupChoice) => {
    setPhase({ kind: "creating" });

    void createAiGame({
      personality: choice.personality,
      color: choice.color === "w" ? "white" : "black",
      timeControl: choice.timeControl,
      variant: choice.variant,
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
      return <Setup askTimeControl onStart={start} />;
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
      <ErrorNotice
        title="Couldn't start an online game"
        message={message}
        hints={[
          { key: "r", label: "retry" },
          { key: "o", label: "play offline" },
        ]}
      />
    </GameScreen>
  );
}

function ServerMatch({ initial }: { initial: ServerGame }) {
  const theme = useUITheme();
  const toast = useToast();
  const auth = useAuth();
  const navigate = useNavigate();

  useKeymap(MATCH_KEYMAP);

  const [server, setServer] = useState(initial);
  const human = server.yourColor;

  const you = auth.profile?.username ?? "You";
  const bot = `OpenChess ${
    server.personality ? PERSONALITIES[server.personality].name : "Engine"
  }`;

  const cursor = useBoardCursor({
    initialSquare: homeSquare(human),
    initiallyFlipped: human === "b",
  });
  const [pending, setPending] = useState(false);
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [confirmingTakeback, setConfirmingTakeback] = useState(false);

  const game = useReplayedGame(server.history, server.startFen);
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

  const resync = useCallback(async () => {
    try {
      apply(await fetchGame(server.id));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [apply, server.id, setMessage]);

  const flag = useCallback(async () => {
    if (pending || over) {
      return;
    }
    setPending(true);

    try {
      apply(await flagGame(server.id));
    } catch (error) {
      if (error instanceof GameConflictError) {
        await resync();
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }, [apply, over, pending, resync, server.id, setMessage]);

  const live = useClock({
    clock: server.clock,
    over,
    onExpire: (color) => {
      if (color === human) {
        void flag();
      }
    },
  });

  const clocks = orientClocks({
    live,
    running: server.clock?.running ?? "w",
    over,
    flipped: cursor.flipped,
    labelFor: (color) => (color === human ? "You" : "Engine"),
  });

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
      const preset = server.timeControl
        ? timeControlFor(
            server.timeControl.initialSeconds,
            server.timeControl.incrementSeconds,
          )
        : null;

      const created = await createAiGame({
        personality: server.personality ?? "maestro",
        color: human === "w" ? "white" : "black",
        timeControl: preset?.key ?? null,
        variant: server.variant,
      });
      setServer(created);
      cursor.resetCursor();
      clearSelection();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [
    clearSelection,
    cursor.resetCursor,
    human,
    setMessage,
    server.timeControl,
    server.variant,
    server.personality,
  ]);

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

  const takeBack = useCallback(async () => {
    setConfirmingTakeback(false);
    setPending(true);
    setMessage(null);

    try {
      apply(await offerTakeback(server.id));
    } catch (error) {
      if (error instanceof GameConflictError) {
        try {
          apply(await fetchGame(server.id));
        } catch (refetch) {
          setMessage(errorMessage(refetch));
        }
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }, [apply, server.id, setMessage]);

  const handleEscape = useCallback(
    () =>
      selection.handleEscape(() => {
        if (confirmingResign) {
          setConfirmingResign(false);
          return true;
        }
        if (confirmingTakeback) {
          setConfirmingTakeback(false);
          return true;
        }
        return false;
      }),
    [confirmingResign, confirmingTakeback, selection.handleEscape],
  );

  useGameKeys({
    selection,
    cursor,
    commit,
    copy: {
      game,
      pgn: serverPgnDetails({
        event: "OpenChess AI game",
        startedAt: server.startedAt,
        result: server.result,
        white: server.yourColor === "w" ? you : bot,
        black: server.yourColor === "b" ? you : bot,
      }),
      refuse: over ? null : "Not while the game is on — press y once it's over",
      onNote: setMessage,
    },
    before: (name) => {
      if (confirmingResign && name !== "x") {
        setConfirmingResign(false);
      }
      if (confirmingTakeback && name !== "u") {
        setConfirmingTakeback(false);
      }
    },
    onKey: (name) => {
      switch (name) {
        case "u":
          if (pending || over) {
            break;
          }
          if (server.takebacks > 0 || confirmingTakeback) {
            void takeBack();
          } else {
            setConfirmingTakeback(true);
          }
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
        case "a":
          if (over) {
            void navigate("/analysis", { state: { gameId: server.id } });
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

    if (confirmingTakeback) {
      return "Take that back? It voids this game's XP and coins — u again";
    }

    if (selection.message) {
      return selection.message;
    }

    if (server.result === "ABORTED") {
      return "Game aborted — press r to play again";
    }

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
        server.personality ? PERSONALITIES[server.personality].name : "Engine"
      }${server.variant === "CHESS960" ? " · Chess960" : ""}`}
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
          {over ? null : (
            <>
              <span fg={theme.cream}>u</span>
              <span fg={theme.faint}> take back </span>
            </>
          )}
          {over ? (
            <>
              <span fg={theme.cream}>a</span>
              <span fg={theme.faint}> analyze </span>
              <span fg={theme.cream}>y</span>
              <span fg={theme.faint}> copy </span>
            </>
          ) : null}
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
        clocks={clocks}
      />

      {server.takebacks > 0 && !over ? (
        <text>
          <span fg={theme.faint}>
            {server.takebacks === 1
              ? "1 move taken back — this game pays no XP or coins"
              : `${server.takebacks} moves taken back — this game pays no XP or coins`}
          </span>
        </text>
      ) : null}

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
