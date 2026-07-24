import { useCallback, useEffect, useRef, useState } from "react";
import {
  isGameOver,
  opposite,
  TIME_CONTROLS,
  timeControlFor,
  toAlgebraic,
} from "@openchess/shared";
import type {
  Color,
  GameStatus,
  PromotionPiece,
  TimeControlKey,
} from "@openchess/shared";
import { useKeyboard } from "@opentui/react";
import { useLocation, useNavigate } from "react-router";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { MatchView, orientClocks } from "../components/match-view";
import { describeStatus } from "../components/game-panels";
import {
  GameConflictError,
  abortGame,
  claimVictory,
  fetchGame,
  flagGame,
  joinPvpQueue,
  leavePvpQueue,
  resignGame,
  sendMove,
  type ServerGame,
} from "../lib/games";
import { offerRematch } from "../lib/challenges";
import { subscribeToGame } from "../lib/game-events";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import { homeSquare, useBoardCursor } from "../hooks/use-board-cursor";
import { useClock } from "../hooks/use-clock";
import { useGameKeys } from "../hooks/use-game-keys";
import { useMoveSelection } from "../hooks/use-move-selection";
import { useReplayedGame } from "../hooks/use-replayed-game";

const TITLE = "Online 1v1";
const SUBTITLE = "Challenge a player over the network";

/**
 * How often a searching player pokes the queue — also its heartbeat.
 *
 * The queue is still polled, unlike a live game: a poll *is* the "I am still
 * here" signal the server pairs on, so there is nothing to push until there is
 * something to say, and by then the poll has already asked.
 */
const QUEUE_POLL_MS = 2_000;

/**
 * How long the opponent must sit on their turn before we offer the claim key.
 * Matches the server's own window; ours starts later (when this client saw the
 * position), so by the time the offer shows, the server already agrees.
 */
const CLAIM_AFTER_MS = 5 * 60_000;

/** The status line reworded for a game against a named human. */
function describeOnlineStatus(
  status: GameStatus,
  turn: Color,
  you: Color,
  opponent: string,
): string {
  switch (status) {
    case "checkmate":
      return opposite(turn) === you
        ? "Checkmate — you win!"
        : `Checkmate — ${opponent} wins`;
    case "check":
      return turn === you
        ? "Your move — check!"
        : `${opponent} to move — check!`;
    case "playing":
      return turn === you ? "Your move" : `Waiting for ${opponent}…`;
    default:
      return describeStatus(status, turn);
  }
}

/**
 * Online 1v1: matched by the server's queue, played move by move over the
 * same authoritative API as AI games, with the opponent's moves arriving by
 * poll. Rating here is the real thing — PvP is the only place it moves.
 */
export function OnlineGame() {
  const auth = useAuth();
  const theme = useUITheme();
  const location = useLocation();
  const [match, setMatch] = useState<ServerGame | null>(null);
  // `undefined` until the player picks a clock; `null` is an untimed queue.
  const [timeControl, setTimeControl] = useState<
    TimeControlKey | null | undefined
  >(undefined);

  // A game handed to us by name rather than by the queue — an accepted
  // challenge, or a rematch. The board opens straight on it, skipping both the
  // clock picker and the search.
  const openGameId =
    (location.state as { gameId?: string } | null)?.gameId ?? null;
  const [opening, setOpening] = useState(openGameId !== null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (openGameId === null) {
      return;
    }

    let cancelled = false;
    setOpening(true);
    setOpenError(null);

    void fetchGame(openGameId)
      .then((game) => {
        if (!cancelled) {
          setMatch(game);
          setOpening(false);
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          setOpenError(errorMessage(cause));
          setOpening(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [openGameId]);

  const onMatched = useCallback((game: ServerGame) => setMatch(game), []);
  // A rematch drops back into the same queue, keeping the chosen clock.
  const onRequeue = useCallback(() => setMatch(null), []);

  if (auth.status === "checking") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <text fg={theme.dim}>Checking your session…</text>
      </GameScreen>
    );
  }

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <box flexDirection="column" alignItems="center" gap={1}>
          <text fg={theme.gold}>Online play needs an account</text>
          <text fg={theme.dim}>
            Sign in from the home screen, then come back.
          </text>
        </box>
      </GameScreen>
    );
  }

  if (match) {
    return <OnlineMatch key={match.id} initial={match} onRequeue={onRequeue} />;
  }

  if (openError) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <ErrorNotice title="Couldn't open that game" message={openError} />
      </GameScreen>
    );
  }

  if (opening) {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <text fg={theme.dim}>Opening the board…</text>
      </GameScreen>
    );
  }

  if (timeControl === undefined) {
    return <QueueSetup onChoose={setTimeControl} />;
  }

  return (
    <Searching
      timeControl={timeControl}
      onMatched={onMatched}
      onBack={() => setTimeControl(undefined)}
    />
  );
}

/** Pick the clock to queue for. You are only paired with a like-for-like one. */
function QueueSetup({
  onChoose,
}: {
  onChoose: (timeControl: TimeControlKey | null) => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }
    switch (key.name) {
      case "1":
        onChoose(null);
        break;
      case "2":
        onChoose("bullet");
        break;
      case "3":
        onChoose("blitz");
        break;
      case "4":
        onChoose("rapid");
        break;
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE}>
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.walnut}>Choose a time control</text>
        <text>
          <span fg={theme.cream}>1</span>
          <span fg={theme.faint}> Untimed </span>
          <span fg={theme.cream}>2</span>
          <span fg={theme.faint}> {TIME_CONTROLS.bullet.label} </span>
          <span fg={theme.cream}>3</span>
          <span fg={theme.faint}> {TIME_CONTROLS.blitz.label} </span>
          <span fg={theme.cream}>4</span>
          <span fg={theme.faint}> {TIME_CONTROLS.rapid.label}</span>
        </text>
        <text fg={theme.dim}>
          You'll only be paired with a player who picked the same.
        </text>
      </box>
    </GameScreen>
  );
}

/**
 * The queue. Polling is the whole protocol: every poll is a heartbeat, the
 * first poll to find a partner creates the game, and an unfinished online game
 * is returned immediately — so this screen is also how a match is resumed.
 */
function Searching({
  timeControl,
  onMatched,
  onBack,
}: {
  timeControl: TimeControlKey | null;
  onMatched: (game: ServerGame) => void;
  onBack: () => void;
}) {
  const theme = useUITheme();
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  const speedLabel = timeControl ? TIME_CONTROLS[timeControl].label : "Untimed";

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const result = await joinPvpQueue(timeControl);
        if (cancelled) {
          return;
        }

        if (result.status === "matched" && result.game !== null) {
          onMatched(result.game);
          return;
        }

        setMessage(null);
      } catch (error) {
        // Stay in the loop: a missed poll only means we drop out of the queue
        // if it keeps happening, and the message says why we're stuck.
        if (!cancelled) {
          setMessage(errorMessage(error));
        }
      }

      // Guarded so a poll that was in flight at unmount cannot reschedule the
      // loop — an undead loop would quietly re-enqueue us from the home screen.
      if (!cancelled) {
        timer = setTimeout(() => void poll(), QUEUE_POLL_MS);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      // Leaving the screen is leaving the queue, as fast as the network allows
      // rather than by heartbeat timeout.
      void leavePvpQueue();
    };
  }, [onMatched, timeControl]);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <GameScreen
      title={`${TITLE} · ${speedLabel}`}
      subtitle={SUBTITLE}
      onEscape={() => {
        onBack();
        return true;
      }}
    >
      <box flexDirection="column" alignItems="center" gap={1}>
        <text
          fg={theme.walnut}
        >{`Searching for an opponent… ${seconds}s`}</text>
        <text fg={theme.dim}>
          {`You'll be paired with the next ${speedLabel.toLowerCase()} player.`}
        </text>
        {message ? <text fg={theme.gold}>{message}</text> : null}
      </box>
    </GameScreen>
  );
}

function OnlineMatch({
  initial,
  onRequeue,
}: {
  initial: ServerGame;
  onRequeue: () => void;
}) {
  const theme = useUITheme();
  const toast = useToast();
  const auth = useAuth();
  const navigate = useNavigate();

  const [server, setServer] = useState(initial);
  const human = server.yourColor;
  const opponentName = server.opponent?.username ?? "your opponent";
  // The equipped title is the whole point of buying one; the header is where
  // it gets shown off. Status lines keep the bare username so they stay short.
  const opponentDisplay = server.opponent?.title
    ? `${server.opponent.title} ${opponentName}`
    : opponentName;

  const cursor = useBoardCursor({
    initialSquare: homeSquare(human),
    initiallyFlipped: human === "b",
  });
  /** A request is on the wire; the board is read-only until it answers. */
  const [pending, setPending] = useState(false);
  const [confirmingResign, setConfirmingResign] = useState(false);
  /** The opponent has been on the clock long enough to claim the win. */
  const [claimAvailable, setClaimAvailable] = useState(false);

  const game = useReplayedGame(server.history);
  const { position, status } = game;
  const over = server.result !== null || isGameOver(status);

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The game is over — press r to find another",
    you: { color: human, waitMessage: `Waiting for ${opponentName}…` },
    locked: pending,
  });
  const { beginCommit, clearSelection, setMessage } = selection;

  const apply = useCallback(
    (state: ServerGame) => {
      setServer(state);
      clearSelection();

      // The payout moved our header numbers whether or not this response
      // carried our breakdown — the opponent's request may have settled it.
      if (state.result !== null) {
        void auth.refresh();
      }

      const rewards = state.rewards;
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
    },
    [auth, clearSelection, toast],
  );

  // What the board is showing right now, readable from inside the stream
  // callback without making the subscription depend on it. One connection has
  // to outlive every move of the game; an effect that re-ran on each ply would
  // tear the stream down and rebuild it after every single one.
  const latest = useRef(server);
  latest.current = server;

  // The opponent's moves and resignations arrive pushed, not polled. Only a
  // changed board is applied — `apply` clears the current selection, and having
  // a square picked up must survive an event that says nothing new.
  //
  // That same guard is what protects the rewards breakdown: our own move's POST
  // response carries it and the stream's copy never does, so the echo of our
  // move arriving a moment later matches on ply and result and is ignored.
  useEffect(() => {
    if (over) {
      return;
    }

    return subscribeToGame(server.id, {
      onState: (state) => {
        const current = latest.current;
        if (state.ply !== current.ply || state.result !== current.result) {
          apply(state);
        }
      },
    });
  }, [apply, over, server.id]);

  // Arms the claim offer while the opponent sits on their turn. Keyed on ply,
  // not the turn value: only an actual move resets the clock, the same event
  // the server measures from.
  useEffect(() => {
    setClaimAvailable(false);

    if (over || position.turn === human) {
      return;
    }

    const timer = setTimeout(() => setClaimAvailable(true), CLAIM_AFTER_MS);

    return () => clearTimeout(timer);
  }, [human, over, position.turn, server.ply]);

  /** Refetch and accept whatever the server says; our picture was stale. */
  const resync = useCallback(async () => {
    try {
      apply(await fetchGame(server.id));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [apply, server.id, setMessage]);

  /**
   * Settle on time: cash in the opponent's fallen flag, or concede our own.
   * The server decides which it is, so a clock that only looks fallen to us
   * (a lagging tick) comes back a conflict and we just resync.
   */
  const flag = useCallback(async () => {
    if (pending || over) {
      return;
    }
    setPending(true);
    setMessage(null);

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
    onExpire: () => void flag(),
  });

  const clocks = orientClocks({
    live,
    running: server.clock?.running ?? "w",
    over,
    flipped: cursor.flipped,
    labelFor: (color) => (color === human ? "You" : opponentName),
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

  /**
   * Give up the game. Before the first move it is an abort — settled with no
   * loss on either record, the way out of a match whose opponent never showed —
   * and once under way it is a resignation.
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

  /**
   * Offer this opponent another game. It becomes an ordinary challenge in
   * their list — there is nothing to wait on here, so the screen says it was
   * sent and the game, if they take it, arrives from the challenge list.
   */
  const rematch = useCallback(async () => {
    setPending(true);
    setMessage(null);

    try {
      await offerRematch(server.id);
      setMessage(`Rematch offered to ${opponentName} — check Challenges`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [opponentName, server.id, setMessage]);

  /** Take the win from an opponent who walked away. The server is the judge. */
  const claim = useCallback(async () => {
    setPending(true);
    setMessage(null);

    try {
      apply(await claimVictory(server.id));
    } catch (error) {
      if (error instanceof GameConflictError) {
        // The opponent moved after all, or the server's clock lags ours.
        await resync();
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPending(false);
    }
  }, [apply, resync, server.id, setMessage]);

  // Escape's extra step here: a pending resign confirmation. Leaving mid-game
  // is fine — the game stays active, and the queue hands it straight back the
  // next time this screen opens.
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
            onRequeue();
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
        case "c":
          if (claimAvailable && !pending && !over) {
            void claim();
          }
          break;
        case "a":
          // A finished rated game is worth reviewing; jump straight in.
          if (over) {
            void navigate("/analysis", { state: { gameId: server.id } });
          }
          break;
        case "p":
          // `r` already means "back to the queue"; a rematch is the other
          // thing you might want from a finished game, so it gets its own key.
          if (over && !pending && server.result !== "ABORTED") {
            void rematch();
          }
          break;
      }
    },
  });

  const statusText = (): string => {
    if (pending) {
      return "Sending your move…";
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
      return "Game aborted — press r to search again";
    }

    // A result on a position that isn't terminal can only be a resignation.
    if (server.result !== null && !isGameOver(status)) {
      const won = (server.result === "WHITE_WIN") === (human === "w");
      return won
        ? `${opponentName} resigned — you win!`
        : `You resigned — ${opponentName} wins`;
    }

    if (claimAvailable) {
      return `${opponentName} has gone quiet — press c to claim the win`;
    }

    return describeOnlineStatus(status, position.turn, human, opponentName);
  };

  const rewards =
    server.result !== null && server.result !== "ABORTED"
      ? server.rewards
      : null;

  const speed = server.timeControl
    ? (timeControlFor(
        server.timeControl.initialSeconds,
        server.timeControl.incrementSeconds,
      )?.name ?? null)
    : null;

  return (
    <GameScreen
      title={`${TITLE}${speed ? ` · ${speed}` : ""} · vs ${opponentDisplay}`}
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
          {claimAvailable ? (
            <>
              <span fg={theme.cream}>c</span>
              <span fg={theme.faint}> claim win </span>
            </>
          ) : null}
          {over ? (
            <>
              <span fg={theme.cream}>a</span>
              <span fg={theme.faint}> analyze </span>
              {server.result === "ABORTED" ? null : (
                <>
                  <span fg={theme.cream}>p</span>
                  <span fg={theme.faint}> rematch </span>
                </>
              )}
            </>
          ) : null}
          <span fg={theme.cream}>r</span>
          <span fg={theme.faint}> new game </span>
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
