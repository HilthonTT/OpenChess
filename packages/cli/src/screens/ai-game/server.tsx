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
  pieceAt,
  pieceColor,
  playSan,
  rankOf,
  squareAt,
  toAlgebraic,
} from "@openchess/shared";
import type {
  Color,
  Difficulty,
  Game,
  PromotionPiece,
} from "@openchess/shared";
import { Board } from "../../components/board";
import { GameScreen } from "../../components/game-screen";
import {
  CapturedSummary,
  MoveList,
  PROMOTION_CHOICES,
  PromotionPrompt,
  colorName,
} from "../../components/game-panels";
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
import { DIFFICULTY_LABELS, Setup, clamp, describeAiStatus } from "./setup";
import { LocalAIGame } from "./local";
import { errorMessage } from "../../lib/utils";

/** The board as the server tells it, rebuilt move by move from its SAN history. */
function replayHistory(history: string[]): Game {
  let game = createGame();
  for (const san of history) {
    game = playSan(game, san);
  }
  return game;
}

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
  const { isTopLayer } = useKeyboardLayer();

  const [server, setServer] = useState(initial);
  const human = server.yourColor;

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
    [auth, toast],
  );

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
      setMessage("The game is over — press r to play again");
      return;
    }

    if (position.turn !== human) {
      setMessage("The engine is thinking…");
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

  const newGame = useCallback(async () => {
    setPending(true);
    setMessage(null);

    try {
      const created = await createAiGame({
        difficulty: server.difficulty ?? "MEDIUM",
        color: human === "w" ? "white" : "black",
      });
      setServer(created);
      setCursor(squareAt(4, human === "w" ? 1 : 6));
      setSelected(null);
      setPromotion(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setPending(false);
    }
  }, [human, server.difficulty]);

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

    // Leaving mid-game is fine: the game stays active and is resumed on return.
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
      case "f":
        setFlipped((value) => !value);
        break;
    }
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

    if (message) {
      return message;
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
