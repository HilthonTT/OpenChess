import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatPhraseText,
  chatPhrasesFor,
  isGameOver,
  opposite,
  TIME_CONTROLS,
  timeControlFor,
  toAlgebraic,
} from "@openchess/shared";
import type {
  ChatPhraseId,
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
import { SignedOut } from "../components/signed-out";
import {
  GameConflictError,
  abortGame,
  acceptDraw,
  claimVictory,
  declineDraw,
  fetchGame,
  flagGame,
  joinPvpQueue,
  leavePvpQueue,
  offerDraw,
  resignGame,
  sendChatMessage,
  sendMove,
  type ChatMessage,
  type ServerGame,
} from "../lib/games";
import { offerRematch } from "../lib/challenges";
import { serverPgnDetails } from "../lib/copy-game";
import { alertFor } from "../lib/game-alerts";
import { subscribeToGame } from "../lib/game-events";
import { notify } from "../lib/notify";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { BOARD_ESCAPE, BOARD_KEYS, COPY_KEYS } from "../lib/keymaps";
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

/**
 * The layer the phrase picker takes while it is open, so the board's own keys
 * go quiet underneath it — `1` has to mean "say hello" and not fall through to
 * anything the board might one day bind it to.
 */
const CHAT_LAYER_ID = "online-chat";

/** Messages kept on screen. The server sends a window; this is what fits under a board. */
const CHAT_LINES = 4;

/** The newest message's id, or "" — how a client tells one transcript from another. */
function lastMessageId(game: { chat: ChatMessage[] }): string {
  return game.chat.at(-1)?.id ?? "";
}

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

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE}>
        <SignedOut
          title="Online play needs an account"
          message="These are the games that move your Elo."
        />
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

const QUEUE_KEYMAP: Keymap = {
  title: "Online 1v1 — the queue",
  sections: [
    {
      title: "Pick a clock — you are only paired with a like-for-like one",
      keys: [
        { keys: "1", label: "untimed" },
        { keys: "2", label: "bullet" },
        { keys: "3", label: "blitz" },
        { keys: "4", label: "rapid" },
      ],
    },
  ],
};

/** Pick the clock to queue for. You are only paired with a like-for-like one. */
function QueueSetup({
  onChoose,
}: {
  onChoose: (timeControl: TimeControlKey | null) => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeymap(QUEUE_KEYMAP);

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
          // Nobody sits and watches a queue. Being left is what this screen is
          // for, so the pairing is rung for unconditionally — there is no
          // "they answered quickly" case here, only a wait that just ended.
          notify(
            `Matched with ${result.game.opponent?.username ?? "an opponent"}`,
          );
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
  /** Your own name, for the header of a PGN copied off a finished game. */
  const you = auth.profile?.username ?? "You";
  // The equipped title is the whole point of buying one; the header is where
  // it gets shown off. Status lines keep the bare username so they stay short.
  const opponentDisplay = server.opponent?.title
    ? `${server.opponent.title} ${opponentName}`
    : opponentName;

  const cursor = useBoardCursor({
    initialSquare: homeSquare(human),
    initiallyFlipped: human === "b",
  });
  /**
   * A request is on the wire; the board is read-only until it answers. The value
   * is the status line to show while it is — not every action here is a move, and
   * a draw offer announcing itself as one would be a lie the player can see.
   */
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [confirmingResign, setConfirmingResign] = useState(false);
  /** A draw offer is one keypress from being sent; `d` again confirms it. */
  const [confirmingDraw, setConfirmingDraw] = useState(false);
  /** The opponent has been on the clock long enough to claim the win. */
  const [claimAvailable, setClaimAvailable] = useState(false);
  /** The phrase picker is open and taking the digits. */
  const [saying, setSaying] = useState(false);

  const game = useReplayedGame(server.history, server.startFen);
  const { position, status } = game;
  const over = server.result !== null || isGameOver(status);

  /** Whose draw offer is standing, if either side's. */
  const theirDrawOffer =
    server.drawOfferFrom !== null && server.drawOfferFrom !== human;
  const myDrawOffer = server.drawOfferFrom === human;

  // `d` and `n` mean three different pairs of things depending on whose offer
  // is on the board, and the footer only has room to say so in four words. The
  // overlay describes whichever reading is live, exactly as the footer does.
  useKeymap(
    useMemo<Keymap>(
      () => ({
        title: "Online 1v1",
        escape: BOARD_ESCAPE,
        sections: [
          { title: "At the board", keys: BOARD_KEYS },
          {
            title: "The draw",
            keys: theirDrawOffer
              ? [
                  { keys: "d", label: `accept ${opponentName}'s draw offer` },
                  { keys: "n", label: "decline it" },
                ]
              : myDrawOffer
                ? [
                    { keys: "n", label: "withdraw your draw offer" },
                    { keys: "d", label: "your offer is already with them" },
                  ]
                : [
                    {
                      keys: "d",
                      label: "offer a draw — pressed twice to confirm",
                    },
                  ],
          },
          {
            title: "The game",
            keys: [
              { keys: "x", label: "resign — pressed twice to confirm" },
              { keys: "t", label: "say one of nine phrases" },
              { keys: "c", label: "claim the win from an opponent who left" },
              { keys: "r", label: "back to the queue, once the game is over" },
              { keys: "p", label: "offer a rematch, once the game is over" },
              { keys: "a", label: "review the game, once it is over" },
              { keys: "u", label: "no undo in a rated game" },
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
      }),
      [myDrawOffer, opponentName, theirDrawOffer],
    ),
  );

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The game is over — press r to find another",
    you: { color: human, waitMessage: `Waiting for ${opponentName}…` },
    locked: busy,
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

  /**
   * Whether a request of ours is waiting on the server, read from that same
   * callback. A change landing while one is in flight is most likely its echo,
   * and our own resignation is not news worth ringing a bell about.
   */
  const awaitingOurOwn = useRef(pending);
  awaitingOurOwn.current = pending;

  /**
   * When the opponent's turn began, by this terminal's clock rather than the
   * game's — an untimed game has no clock, and the question the bell asks is
   * how long *this* terminal has been sitting there with nothing happening in
   * it.
   *
   * Written from the effect below rather than from here, which is what makes it
   * hold the right value when it is read: the effect runs after the render that
   * applied a state, so at the moment the next one arrives it still says when
   * the turn that state ends began.
   */
  const theirTurnSince = useRef<number | null>(null);

  // The opponent's moves, resignations, draw offers and messages arrive pushed,
  // not polled. Only a changed board is *applied* — `apply` clears the current
  // selection, and having a square picked up must survive an event that says
  // nothing new.
  //
  // That same guard is what protects the rewards breakdown: our own move's POST
  // response carries it and the stream's copy never does, so the echo of our
  // move arriving a moment later matches on ply and result and is ignored.
  //
  // A draw offer moves neither the ply nor the result, so it has to be named here
  // too or the one board change that is pure negotiation would be filtered out as
  // "nothing new" — and an offer nobody is told about is not an offer.
  //
  // A message moves none of the three, and is also not a board change at all: it
  // takes the narrow path, which copies the transcript across and leaves
  // everything else — the held selection, the rewards line — exactly where it
  // was. Being told "nice move" must not put your piece back down.
  //
  // Gated on whether the game was live when this screen opened rather than on
  // `over`, so the subscription survives the game ending. The server keeps the
  // stream open for a minute and a half past the result precisely so the "good
  // game" afterwards lands, and an effect that tore down on `over` would hang up
  // a moment before it arrived.
  const wasLiveOnOpen = initial.result === null;

  useEffect(() => {
    if (!wasLiveOnOpen) {
      return;
    }

    return subscribeToGame(server.id, {
      onState: (state) => {
        const current = latest.current;

        if (
          state.ply !== current.ply ||
          state.result !== current.result ||
          state.drawOfferFrom !== current.drawOfferFrom
        ) {
          // Ring the terminal first, while the state that is about to be
          // applied can still be compared with the one it replaces. Most of
          // these changes are not worth a bell and `alertFor` says which.
          const alert = alertFor({
            state,
            previous: current,
            you: human,
            opponent: opponentName,
            theirTurnSince: theirTurnSince.current,
            now: Date.now(),
            awaitingOurOwn: awaitingOurOwn.current !== null,
          });

          if (alert !== null) {
            notify(alert);
          }

          apply(state);
          return;
        }

        if (lastMessageId(state) !== lastMessageId(current)) {
          setServer((previous) => ({ ...previous, chat: state.chat }));
        }
      },
    });
  }, [apply, human, opponentName, server.id, wasLiveOnOpen]);

  // Arms the claim offer while the opponent sits on their turn, and starts the
  // shorter count the bell reads. Keyed on ply, not the turn value: only an
  // actual move resets the clock, the same event the server measures from.
  useEffect(() => {
    setClaimAvailable(false);

    if (over || position.turn === human) {
      theirTurnSince.current = null;
      return;
    }

    theirTurnSince.current = Date.now();

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
    if (busy || over) {
      return;
    }
    setPending("Settling on time…");
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
      setPending(null);
    }
  }, [apply, busy, over, resync, server.id, setMessage]);

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

      setPending("Sending your move…");

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
        setPending(null);
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
    setPending(server.ply === 0 ? "Aborting…" : "Resigning…");
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
      setPending(null);
    }
  }, [apply, server.id, server.ply, setMessage]);

  /**
   * Offer a draw — or, when the opponent's offer is already standing, agree to
   * it. The server makes that call, so the two cases are one request here: it is
   * the same keypress either way, and treating a simultaneous exchange of offers
   * as agreement is the server's business, not the board's.
   */
  const proposeDraw = useCallback(async () => {
    setConfirmingDraw(false);
    setPending("Offering a draw…");
    setMessage(null);

    try {
      apply(await offerDraw(server.id));
    } catch (error) {
      if (error instanceof GameConflictError) {
        await resync();
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPending(null);
    }
  }, [apply, resync, server.id, setMessage]);

  /** Take the draw they offered. A conflict means it is no longer on the table. */
  const takeDraw = useCallback(async () => {
    setPending("Accepting the draw…");
    setMessage(null);

    try {
      apply(await acceptDraw(server.id));
    } catch (error) {
      if (error instanceof GameConflictError) {
        await resync();
      } else {
        setMessage(errorMessage(error));
      }
    } finally {
      setPending(null);
    }
  }, [apply, resync, server.id, setMessage]);

  /** Clear the offer on the board: theirs declined, or ours withdrawn. */
  const refuseDraw = useCallback(async () => {
    const mine = myDrawOffer;
    setPending(mine ? "Withdrawing your offer…" : "Declining the draw…");
    setMessage(null);

    try {
      apply(await declineDraw(server.id));
      setMessage(mine ? "Draw offer withdrawn" : "Draw declined");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(null);
    }
  }, [apply, myDrawOffer, server.id, setMessage]);

  /**
   * Offer this opponent another game. It becomes an ordinary challenge in
   * their list — there is nothing to wait on here, so the screen says it was
   * sent and the game, if they take it, arrives from the challenge list.
   */
  const rematch = useCallback(async () => {
    setPending("Offering a rematch…");
    setMessage(null);

    try {
      await offerRematch(server.id);
      setMessage(`Rematch offered to ${opponentName} — check Challenges`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(null);
    }
  }, [opponentName, server.id, setMessage]);

  /**
   * The nine phrases, led by the ones that fit where the game is.
   *
   * The whole catalog is always on screen and only its order moves: a picker
   * whose contents changed under you would be worse than one whose best answer
   * is not always first, and "sorry" has to stay reachable at every point in a
   * game.
   */
  const phrases = useMemo(
    () => chatPhrasesFor(over ? "end" : server.ply < 2 ? "start" : "any"),
    [over, server.ply],
  );

  /**
   * Say one of them.
   *
   * Deliberately outside `pending`, unlike every other request on this screen.
   * Those all change the game and have to lock the board until the server
   * agrees; this one changes nothing about the position, and freezing the
   * pieces because somebody typed "nice move" would make the feature cost a
   * tempo in a bullet game.
   */
  const say = useCallback(
    async (phrase: ChatPhraseId) => {
      setSaying(false);

      try {
        const chat = await sendChatMessage(server.id, phrase);
        setServer((previous) => ({ ...previous, chat }));
      } catch (error) {
        setMessage(errorMessage(error));
      }
    },
    [server.id, setMessage],
  );

  const { push: pushLayer, pop: popLayer, isTopLayer } = useKeyboardLayer();

  // The picker owns the keyboard while it is open, which is what lets it bind
  // the digits without the board underneath having to know they are spoken for.
  useEffect(() => {
    if (!saying) {
      return;
    }

    pushLayer(CHAT_LAYER_ID);
    return () => popLayer(CHAT_LAYER_ID);
  }, [popLayer, pushLayer, saying]);

  useKeyboard((key) => {
    if (!isTopLayer(CHAT_LAYER_ID)) {
      return;
    }

    if (key.name === "escape" || key.name === "t") {
      setSaying(false);
      return;
    }

    const choice = Number(key.name);

    if (Number.isInteger(choice) && choice >= 1 && choice <= phrases.length) {
      void say(phrases[choice - 1]!.id);
    }
  });

  /** Take the win from an opponent who walked away. The server is the judge. */
  const claim = useCallback(async () => {
    setPending("Claiming the win…");
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
      setPending(null);
    }
  }, [apply, resync, server.id, setMessage]);

  // Escape's extra steps here: a pending resign or draw confirmation. Leaving
  // mid-game is fine — the game stays active, and the queue hands it straight
  // back the next time this screen opens.
  const handleEscape = useCallback(
    () =>
      selection.handleEscape(() => {
        if (confirmingResign) {
          setConfirmingResign(false);
          return true;
        }
        if (confirmingDraw) {
          setConfirmingDraw(false);
          return true;
        }
        return false;
      }),
    [confirmingDraw, confirmingResign, selection.handleEscape],
  );

  useGameKeys({
    selection,
    cursor,
    commit,
    copy: {
      game,
      pgn: serverPgnDetails({
        event: "OpenChess online game",
        startedAt: server.startedAt,
        result: server.result,
        white: human === "w" ? you : opponentName,
        black: human === "b" ? you : opponentName,
      }),
      // A rated game against a person is the one board where an engine's
      // opinion is worth something to someone, so the position does not leave
      // this screen until the result is in. It is the same reading the analysis
      // screen gets by only ever opening on a finished game.
      refuse: over ? null : "Not while the game is on — press y once it's over",
      onNote: setMessage,
    },
    // A pending confirmation is called off by any key that isn't its own confirm.
    before: (name) => {
      if (confirmingResign && name !== "x") {
        setConfirmingResign(false);
      }
      if (confirmingDraw && name !== "d") {
        setConfirmingDraw(false);
      }
    },
    onKey: (name) => {
      switch (name) {
        case "u":
          setMessage("There's no undo in a rated game");
          break;
        case "r":
          if (busy) {
            break;
          }
          if (over) {
            onRequeue();
          } else {
            setMessage("Finish the game first — press x to resign");
          }
          break;
        case "x":
          if (busy || over) {
            break;
          }
          if (confirmingResign) {
            void concede();
          } else {
            setConfirmingResign(true);
          }
          break;
        case "d":
          // The draw key, in all three of its readings. Answering an offer needs
          // no confirmation — the player is replying to a question already on the
          // screen — but starting one does, so half a game is not given away by a
          // stray keypress.
          if (busy || over) {
            break;
          }
          if (theirDrawOffer) {
            void takeDraw();
          } else if (myDrawOffer) {
            setMessage(
              `Your draw offer is with ${opponentName} — n withdraws it`,
            );
          } else if (confirmingDraw) {
            void proposeDraw();
          } else {
            setConfirmingDraw(true);
          }
          break;
        case "n":
          // Only ever means "no draw": declining theirs or withdrawing ours.
          if (busy || over || server.drawOfferFrom === null) {
            break;
          }
          void refuseDraw();
          break;
        case "c":
          if (claimAvailable && !busy && !over) {
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
          if (over && !busy && server.result !== "ABORTED") {
            void rematch();
          }
          break;
        case "t":
          // Talk. Available after the result too — see `say`.
          setSaying(true);
          break;
      }
    },
  });

  const statusText = (): string => {
    if (pending !== null) {
      return pending;
    }

    if (confirmingResign) {
      return server.ply === 0
        ? "Abort this game? Press x again to confirm"
        : "Resign this game? Press x again to confirm";
    }

    if (confirmingDraw) {
      return "Offer a draw? Press d again to confirm";
    }

    if (selection.message) {
      return selection.message;
    }

    if (server.result === "ABORTED") {
      return "Game aborted — press r to search again";
    }

    // A result on a position that isn't terminal was agreed rather than played
    // out: a draw both sides signed, or a resignation.
    if (server.result !== null && !isGameOver(status)) {
      if (server.result === "DRAW") {
        return "Draw agreed — press r to search again";
      }
      const won = (server.result === "WHITE_WIN") === (human === "w");
      return won
        ? `${opponentName} resigned — you win!`
        : `You resigned — ${opponentName} wins`;
    }

    // An offer on the table outranks the position: it is a question addressed to
    // this player, and the turn indicator will still be there once it is answered.
    if (theirDrawOffer) {
      return `${opponentName} offers a draw — d accepts, n declines`;
    }

    if (claimAvailable) {
      return `${opponentName} has gone quiet — press c to claim the win`;
    }

    if (myDrawOffer) {
      return `Draw offered — waiting on ${opponentName}`;
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
          {/* The draw keys read as whatever they currently do: accept/decline
              while an offer is on the table, and plain "draw" otherwise. */}
          {over ? null : theirDrawOffer ? (
            <>
              <span fg={theme.cream}>d</span>
              <span fg={theme.faint}> accept draw </span>
              <span fg={theme.cream}>n</span>
              <span fg={theme.faint}> decline </span>
            </>
          ) : myDrawOffer ? (
            <>
              <span fg={theme.cream}>n</span>
              <span fg={theme.faint}> withdraw draw </span>
            </>
          ) : (
            <>
              <span fg={theme.cream}>d</span>
              <span fg={theme.faint}> draw </span>
            </>
          )}
          {claimAvailable ? (
            <>
              <span fg={theme.cream}>c</span>
              <span fg={theme.faint}> claim win </span>
            </>
          ) : null}
          <span fg={theme.cream}>t</span>
          <span fg={theme.faint}> say </span>
          {over ? (
            <>
              <span fg={theme.cream}>a</span>
              <span fg={theme.faint}> analyze </span>
              <span fg={theme.cream}>y</span>
              <span fg={theme.faint}> copy </span>
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

      {saying ? (
        <PhrasePicker phrases={phrases} />
      ) : (
        <ChatLog messages={server.chat} opponent={opponentName} />
      )}

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

/**
 * What has been said, newest last.
 *
 * Renders nothing at all until there is something to show, rather than holding
 * an empty box open: most games are played in silence, and a permanently blank
 * pane under the board would cost every one of them four rows.
 */
function ChatLog({
  messages,
  opponent,
}: {
  messages: ChatMessage[];
  /** Who to name on the half of the log that is not yours. */
  opponent: string;
}) {
  const theme = useUITheme();

  if (messages.length === 0) {
    return null;
  }

  return (
    <box flexDirection="column">
      {messages.slice(-CHAT_LINES).map((message) => (
        <text key={message.id}>
          <span fg={message.mine ? theme.walnut : theme.gold}>
            {`${(message.mine ? "you" : opponent).slice(0, 12)}: `}
          </span>
          {/* The wire carries a key; the text is looked up here. Nothing the
              opponent controls ever reaches this line. */}
          <span fg={message.mine ? theme.dim : theme.cream}>
            {chatPhraseText(message.phrase)}
          </span>
        </text>
      ))}
    </box>
  );
}

/** The nine things, numbered. */
function PhrasePicker({
  phrases,
}: {
  phrases: ReturnType<typeof chatPhrasesFor>;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column">
      <text fg={theme.walnut}>Say something — esc to close</text>
      {/* Three to a row: nine phrases stacked would push the board off an
          80x24 terminal, which is the size this whole screen is drawn for. */}
      {[0, 3, 6].map((start) => (
        <text key={start}>
          {phrases.slice(start, start + 3).map((phrase, i) => (
            <span key={phrase.id}>
              <span fg={theme.cream}>{` ${start + i + 1} `}</span>
              <span fg={theme.dim}>{phrase.text.padEnd(14)}</span>
            </span>
          ))}
        </text>
      ))}
    </box>
  );
}
