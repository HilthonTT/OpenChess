import { useCallback, useEffect, useMemo, useState } from "react";
import { useKeyboard } from "@opentui/react";
import {
  createGame,
  fileOf,
  findKing,
  findLegalMove,
  isGameOver,
  isPiece,
  movesFromSquare,
  needsPromotion,
  opposite,
  pieceAt,
  pieceColor,
  playSan,
  rankOf,
  squareAt,
  toAlgebraic,
} from "@openchess/shared";
import type { Color, Game, GameStatus, PromotionPiece } from "@openchess/shared";
import { Board } from "../components/board";
import { GameScreen } from "../components/game-screen";
import {
  CapturedSummary,
  MoveList,
  PROMOTION_CHOICES,
  PromotionPrompt,
  colorName,
  describeStatus,
} from "../components/game-panels";
import {
  GameConflictError,
  abortGame,
  fetchGame,
  joinPvpQueue,
  leavePvpQueue,
  resignGame,
  sendMove,
  type ServerGame,
} from "../lib/games";
import { errorMessage } from "../lib/utils";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { useToast } from "../providers/toast";
import { clamp } from "./ai-game/setup";

const TITLE = "Online 1v1";
const SUBTITLE = "Challenge a player over the network";

/** How often a searching player pokes the queue — also its heartbeat. */
const QUEUE_POLL_MS = 2_000;

/** How often a live game checks for the opponent's move or resignation. */
const GAME_POLL_MS = 2_000;

/** The board as the server tells it, rebuilt move by move from its SAN history. */
function replayHistory(history: string[]): Game {
  let game = createGame();
  for (const san of history) {
    game = playSan(game, san);
  }
  return game;
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
      return turn === you ? "Your move — check!" : `${opponent} to move — check!`;
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
  const [match, setMatch] = useState<ServerGame | null>(null);

  const onMatched = useCallback((game: ServerGame) => setMatch(game), []);
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
          <text fg={theme.dim}>Sign in from the home screen, then come back.</text>
        </box>
      </GameScreen>
    );
  }

  return match ? (
    <OnlineMatch key={match.id} initial={match} onRequeue={onRequeue} />
  ) : (
    <Searching onMatched={onMatched} />
  );
}

/**
 * The queue. Polling is the whole protocol: every poll is a heartbeat, the
 * first poll to find a partner creates the game, and an unfinished online game
 * is returned immediately — so this screen is also how a match is resumed.
 */
function Searching({ onMatched }: { onMatched: (game: ServerGame) => void }) {
  const theme = useUITheme();
  const [message, setMessage] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      try {
        const result = await joinPvpQueue();
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

      timer = setTimeout(() => void poll(), QUEUE_POLL_MS);
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
  }, [onMatched]);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE}>
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.walnut}>{`Searching for an opponent… ${seconds}s`}</text>
        <text fg={theme.dim}>
          You'll be paired with the next player who queues up.
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
  const { isTopLayer } = useKeyboardLayer();

  const [server, setServer] = useState(initial);
  const human = server.yourColor;
  const opponentName = server.opponent?.username ?? "your opponent";

  const [cursor, setCursor] = useState(() =>
    squareAt(4, human === "w" ? 1 : 6),
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [promotion, setPromotion] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [flipped, setFlipped] = useState(human === "b");
  const [message, setMessage] = useState<string | null>(null);
  /** A request is on the wire; the board is read-only until it answers. */
  const [pending, setPending] = useState(false);
  const [confirmingResign, setConfirmingResign] = useState(false);

  // The server's history is the game. Replaying it through the same rules code
  // the server runs gives every panel a full local Game to render from.
  const game = useMemo(() => replayHistory(server.history), [server.history]);

  const { position, status } = game;
  const over = server.result !== null || isGameOver(status);
  const targets = selected === null ? [] : movesFromSquare(game, selected);
  const lastMove = game.history[game.history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  const apply = useCallback(
    (state: ServerGame) => {
      setServer(state);
      setSelected(null);
      setPromotion(null);

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
    [auth, toast],
  );

  // The opponent's moves and resignations arrive by poll. Only a changed board
  // is applied — `apply` clears the current selection, and having a square
  // picked up must survive an uneventful poll.
  useEffect(() => {
    if (over || pending) {
      return;
    }

    const timer = setInterval(() => {
      fetchGame(server.id)
        .then((state) => {
          if (state.ply !== server.ply || state.result !== server.result) {
            apply(state);
          }
        })
        .catch(() => {
          // A missed poll is fine; the next one will land.
        });
    }, GAME_POLL_MS);

    return () => clearInterval(timer);
  }, [apply, over, pending, server.id, server.ply, server.result]);

  /** Refetch and accept whatever the server says; our picture was stale. */
  const resync = useCallback(async () => {
    try {
      apply(await fetchGame(server.id));
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }, [apply, server.id]);

  const commit = useCallback(
    async (from: number, to: number, choice?: PromotionPiece) => {
      if (!findLegalMove(game, from, to, choice)) {
        setMessage("That isn't a legal move");
        return;
      }

      setPending(true);
      setSelected(null);
      setPromotion(null);
      setMessage(null);

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
    [apply, game, resync, server.id, server.ply],
  );

  /** Pick up the piece under the cursor, explaining why when we can't. */
  const select = useCallback(
    (square: number) => {
      const piece = pieceAt(position.board, square);

      if (!isPiece(piece)) {
        setMessage("That square is empty");
        return;
      }

      if (pieceColor(piece) !== human) {
        setMessage(`You play the ${colorName(human)} pieces`);
        return;
      }

      if (movesFromSquare(game, square).length === 0) {
        setMessage("That piece has no legal moves");
        return;
      }

      setSelected(square);
      setMessage(null);
    },
    [game, human, position],
  );

  const confirm = useCallback(() => {
    if (pending) {
      return;
    }

    if (over) {
      setMessage("The game is over — press r to find another");
      return;
    }

    if (position.turn !== human) {
      setMessage(`Waiting for ${opponentName}…`);
      return;
    }

    if (selected === null) {
      select(cursor);
      return;
    }

    if (cursor === selected) {
      setSelected(null);
      return;
    }

    if (needsPromotion(game, selected, cursor)) {
      setPromotion({ from: selected, to: cursor });
      return;
    }

    if (findLegalMove(game, selected, cursor)) {
      void commit(selected, cursor);
      return;
    }

    // Not a legal destination: treat it as picking a different piece instead.
    select(cursor);
  }, [
    commit,
    cursor,
    game,
    human,
    opponentName,
    over,
    pending,
    position.turn,
    select,
    selected,
  ]);

  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      // Flipping the board flips which way "up" moves the cursor, so the arrow
      // keys always agree with what the player sees.
      const sign = flipped ? -1 : 1;
      const x = clamp(fileOf(cursor) + dx * sign);
      const y = clamp(rankOf(cursor) + dy * sign);
      setCursor(squareAt(x, y));
    },
    [cursor, flipped],
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
  }, [apply, server.id, server.ply]);

  /** Escape unwinds one step at a time before it gives up the screen. */
  const handleEscape = useCallback(() => {
    if (promotion) {
      setPromotion(null);
      return true;
    }

    if (confirmingResign) {
      setConfirmingResign(false);
      return true;
    }

    if (selected !== null) {
      setSelected(null);
      return true;
    }

    // Leaving mid-game is fine: the game stays active, and the queue hands it
    // straight back the next time this screen opens.
    return false;
  }, [confirmingResign, promotion, selected]);

  useKeyboard((key) => {
    // Game keys belong to the screen itself; stay quiet under any open dialog.
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    if (promotion) {
      const choice = PROMOTION_CHOICES.find(([piece]) => piece === key.name);
      if (choice) {
        void commit(promotion.from, promotion.to, choice[0]);
      }
      return;
    }

    if (confirmingResign && key.name !== "x") {
      setConfirmingResign(false);
    }

    switch (key.name) {
      case "up":
      case "k":
        moveCursor(0, 1);
        break;
      case "down":
      case "j":
        moveCursor(0, -1);
        break;
      case "left":
      case "h":
        moveCursor(-1, 0);
        break;
      case "right":
      case "l":
        moveCursor(1, 0);
        break;
      case "return":
      case "space":
        confirm();
        break;
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
      case "f":
        setFlipped((value) => !value);
        break;
    }
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

    if (message) {
      return message;
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

    return describeOnlineStatus(status, position.turn, human, opponentName);
  };

  const rewards =
    server.result !== null && server.result !== "ABORTED"
      ? server.rewards
      : null;

  return (
    <GameScreen
      title={`${TITLE} · vs ${opponentName}`}
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
          <span fg={theme.faint}> rematch </span>
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
        </>
      }
    >
      <box flexDirection="row" gap={2}>
        <Board
          board={position.board}
          cursor={cursor}
          selected={selected}
          targets={targets}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
        />
        <MoveList game={game} />
      </box>

      <CapturedSummary game={game} />

      {promotion ? (
        <PromotionPrompt />
      ) : (
        <text fg={over ? theme.gold : theme.dim}>{statusText()}</text>
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
