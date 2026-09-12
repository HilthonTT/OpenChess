import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatPhrasesFor,
  describePremove,
  isGameOver,
  timeControlFor,
  toAlgebraic,
} from "@openchess/shared";
import type { ChatPhraseId, PromotionPiece } from "@openchess/shared";
import { useKeyboard } from "@opentui/react";
import { useNavigate } from "react-router";
import { GameScreen } from "../../components/game-screen";
import { MatchView, orientClocks } from "../../components/match-view";
import { ChatLog, PhrasePicker } from "../../components/chat-panel";
import {
  GameConflictError,
  abortGame,
  acceptDraw,
  acceptTakeback,
  claimVictory,
  declineDraw,
  declineTakeback,
  fetchGame,
  flagGame,
  offerDraw,
  offerTakeback,
  resignGame,
  sendChatMessage,
  sendMove,
  type ServerGame,
} from "../../lib/games";
import { offerRematch } from "../../lib/challenges";
import { serverPgnDetails } from "../../lib/copy-game";
import { alertFor } from "../../lib/game-alerts";
import { subscribeToGame } from "../../lib/game-events";
import { notify } from "../../lib/notify";
import { errorMessage } from "../../lib/utils";
import { useAuth } from "../../providers/auth";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../../providers/keymap";
import { BOARD_ESCAPE, BOARD_KEYS, COPY_KEYS } from "../../lib/keymaps";
import { useUITheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";
import { homeSquare, useBoardCursor } from "../../hooks/use-board-cursor";
import { useClock } from "../../hooks/use-clock";
import { useGameKeys } from "../../hooks/use-game-keys";
import { useMoveSelection } from "../../hooks/use-move-selection";
import { useReplayedGame } from "../../hooks/use-replayed-game";

import {
  CHAT_LAYER_ID,
  CLAIM_AFTER_MS,
  describeOnlineStatus,
  lastMessageId,
  TITLE,
} from "./constants";

export function OnlineMatch({
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
  const you = auth.profile?.username ?? "You";
  const opponentDisplay = server.opponent?.title
    ? `${server.opponent.title} ${opponentName}`
    : opponentName;

  const cursor = useBoardCursor({
    initialSquare: homeSquare(human),
    initiallyFlipped: human === "b",
  });
  const [pending, setPending] = useState<string | null>(null);
  const busy = pending !== null;
  const [confirmingResign, setConfirmingResign] = useState(false);
  const [confirmingDraw, setConfirmingDraw] = useState(false);
  const [claimAvailable, setClaimAvailable] = useState(false);
  const [saying, setSaying] = useState(false);

  const game = useReplayedGame(server.history, server.startFen);
  const { position, status } = game;
  const over = server.result !== null || isGameOver(status);

  const theirDrawOffer =
    server.drawOfferFrom !== null && server.drawOfferFrom !== human;
  const myDrawOffer = server.drawOfferFrom === human;

  const theirTakeback =
    server.takebackOfferFrom !== null && server.takebackOfferFrom !== human;
  const myTakeback = server.takebackOfferFrom === human;

  const canAskTakeback =
    server.ply >= 1 && !(server.ply === 1 && position.turn === human);

  useKeymap(
    useMemo<Keymap>(
      () => ({
        title: "Online 1v1",
        escape: BOARD_ESCAPE,
        sections: [
          {
            title: "At the board",
            keys: [
              ...BOARD_KEYS,
              {
                keys: "",
                label: "the same keys queue a premove on their turn",
              },
              { keys: "esc", label: "clear a queued premove" },
            ],
          },
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
            title: "The takeback",
            keys: theirTakeback
              ? [
                  { keys: "u", label: `give ${opponentName} their move back` },
                  { keys: "n", label: "refuse it" },
                ]
              : myTakeback
                ? [
                    { keys: "n", label: "withdraw your takeback request" },
                    { keys: "u", label: "your request is already with them" },
                  ]
                : [
                    { keys: "u", label: "ask for your last move back" },
                    {
                      keys: "",
                      label: "they have to agree; any move clears the request",
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
      [myDrawOffer, myTakeback, opponentName, theirDrawOffer, theirTakeback],
    ),
  );

  const selection = useMoveSelection({
    game,
    cursor: cursor.cursor,
    over,
    overMessage: "The game is over — press r to find another",
    you: { color: human, waitMessage: `Waiting for ${opponentName}…` },
    locked: busy,
    allowPremove: true,
  });
  const { beginCommit, clearSelection, setMessage } = selection;

  const apply = useCallback(
    (state: ServerGame) => {
      setServer(state);
      clearSelection();

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

  const latest = useRef(server);
  latest.current = server;

  const awaitingOurOwn = useRef(pending);
  awaitingOurOwn.current = pending;

  const theirTurnSince = useRef<number | null>(null);

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
          state.drawOfferFrom !== current.drawOfferFrom ||
          state.takebackOfferFrom !== current.takebackOfferFrom
        ) {
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

  useEffect(() => {
    setClaimAvailable(false);

    if (over || position.turn === human) {
      theirTurnSince.current = null;
      return;
    }

    theirTurnSince.current = Date.now();

    const timer = setTimeout(() => setClaimAvailable(true), CLAIM_AFTER_MS);

    return () => clearTimeout(timer);
  }, [human, over, position.turn]);

  const resync = useCallback(async () => {
    try {
      apply(await fetchGame(server.id));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [apply, server.id, setMessage]);

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

  const { clearPremove, runPremove } = selection;

  useEffect(() => {
    if (over) {
      clearPremove();
      return;
    }

    if (busy || position.turn !== human) {
      return;
    }

    runPremove(commit);
  }, [busy, clearPremove, commit, human, over, position.turn, runPremove]);

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

  const proposeTakeback = useCallback(async () => {
    setPending("Asking for your move back…");
    setMessage(null);

    try {
      apply(await offerTakeback(server.id));
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

  const grantTakeback = useCallback(async () => {
    setPending("Giving the move back…");
    setMessage(null);

    try {
      apply(await acceptTakeback(server.id));
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

  const refuseTakeback = useCallback(async () => {
    const mine = myTakeback;
    setPending(mine ? "Withdrawing your request…" : "Refusing the takeback…");
    setMessage(null);

    try {
      apply(await declineTakeback(server.id));
      setMessage(mine ? "Takeback request withdrawn" : "Takeback refused");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(null);
    }
  }, [apply, myTakeback, server.id, setMessage]);

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

  const phrases = useMemo(
    () => chatPhrasesFor(over ? "end" : server.ply < 2 ? "start" : "any"),
    [over, server.ply],
  );

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

  const claim = useCallback(async () => {
    setPending("Claiming the win…");
    setMessage(null);

    try {
      apply(await claimVictory(server.id));
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
      refuse: over ? null : "Not while the game is on — press y once it's over",
      onNote: setMessage,
    },
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
          if (busy || over) {
            break;
          }
          if (theirTakeback) {
            void grantTakeback();
          } else if (myTakeback) {
            setMessage(
              `Your takeback request is with ${opponentName} — n withdraws it`,
            );
          } else if (canAskTakeback) {
            void proposeTakeback();
          } else {
            setMessage("There is no move of yours to take back yet");
          }
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
          if (busy || over) {
            break;
          }
          if (theirTakeback) {
            void refuseTakeback();
          } else if (theirDrawOffer) {
            void refuseDraw();
          } else if (myTakeback) {
            void refuseTakeback();
          } else if (myDrawOffer) {
            void refuseDraw();
          }
          break;
        case "c":
          if (claimAvailable && !busy && !over) {
            void claim();
          }
          break;
        case "a":
          if (over) {
            void navigate("/analysis", { state: { gameId: server.id } });
          }
          break;
        case "p":
          if (over && !busy && server.result !== "ABORTED") {
            void rematch();
          }
          break;
        case "t":
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

    if (server.result !== null && !isGameOver(status)) {
      if (server.result === "DRAW") {
        return "Draw agreed — press r to search again";
      }
      const won = (server.result === "WHITE_WIN") === (human === "w");
      return won
        ? `${opponentName} resigned — you win!`
        : `You resigned — ${opponentName} wins`;
    }

    if (theirTakeback) {
      return `${opponentName} wants their move back — u grants, n refuses`;
    }

    if (theirDrawOffer) {
      return `${opponentName} offers a draw — d accepts, n declines`;
    }

    if (claimAvailable) {
      return `${opponentName} has gone quiet — press c to claim the win`;
    }

    if (myDrawOffer) {
      return `Draw offered — waiting on ${opponentName}`;
    }

    if (myTakeback) {
      return `Takeback asked for — waiting on ${opponentName}`;
    }

    if (selection.premove) {
      return `Premove ${describePremove(selection.premove)} — esc clears it`;
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
          {over ? null : theirTakeback ? (
            <>
              <span fg={theme.cream}>u</span>
              <span fg={theme.faint}> give move back </span>
              <span fg={theme.cream}>n</span>
              <span fg={theme.faint}> refuse </span>
            </>
          ) : myTakeback ? (
            <>
              <span fg={theme.cream}>n</span>
              <span fg={theme.faint}> withdraw takeback </span>
            </>
          ) : canAskTakeback ? (
            <>
              <span fg={theme.cream}>u</span>
              <span fg={theme.faint}> take back </span>
            </>
          ) : null}
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
        premove={selection.premove}
        promotion={selection.promotion !== null}
        over={over}
        statusText={statusText()}
        clocks={clocks}
      />

      {saying ? (
        <PhrasePicker phrases={phrases} />
      ) : (
        <ChatLog
          messages={server.chat}
          nameFor={(message) => (message.mine ? "you" : opponentName)}
        />
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
