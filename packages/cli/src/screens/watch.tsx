import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findKing,
  timeControlFor,
  type Color,
} from "@openchess/shared";
import { useKeyboard } from "@opentui/react";
import { Board } from "../components/board";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { CapturedSummary, MoveList, describeStatus } from "../components/game-panels";
import { HintBar } from "../components/hint-bar";
import { ClockLine, orientClocks } from "../components/match-view";
import { subscribeToSpectatorGame } from "../lib/game-events";
import {
  fetchSpectatorGame,
  listLiveGames,
  type LiveGame,
  type SpectatorGame,
} from "../lib/spectate";
import { errorMessage } from "../lib/utils";
import { useClock } from "../hooks/use-clock";
import { useReplayedGame } from "../hooks/use-replayed-game";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";

const TITLE = "Watch";
const SUBTITLE = "Games being played right now";
const WIDTH = 58;

/** How often the list of live games is refreshed while it is on screen. */
const LIST_POLL_MS = 10_000;

/**
 * Spectating.
 *
 * The board here is fed by the same stream the players' own screens use, so a
 * watcher is never a tick behind them. What they are not given is a move list
 * to play from: the spectator payload has no legal moves in it at all, which is
 * why this screen has no cursor and no way to pick a piece up.
 */
export function Watch() {
  const auth = useAuth();
  const theme = useUITheme();
  const [watching, setWatching] = useState<string | null>(null);

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
          <text fg={theme.gold}>Watching needs an account</text>
          <text fg={theme.dim}>Sign in from the home screen, then come back.</text>
        </box>
      </GameScreen>
    );
  }

  return watching ? (
    <SpectatorBoard gameId={watching} onBack={() => setWatching(null)} />
  ) : (
    <LiveList onOpen={setWatching} />
  );
}

/** Column widths for the live games table. */
const PLAYERS_W = 30;
const SPEED_W = 8;

function speedLabel(game: LiveGame): string {
  if (!game.timeControl) {
    return "Untimed";
  }
  return (
    timeControlFor(
      game.timeControl.initialSeconds,
      game.timeControl.incrementSeconds,
    )?.name ?? "Custom"
  );
}

function faceName(
  player: { username: string; title: string | null } | null,
): string {
  return player?.username ?? "Anonymous";
}

function LiveList({ onOpen }: { onOpen: (gameId: string) => void }) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const live = await listLiveGames();
        if (!cancelled) {
          setGames(live);
          setError(null);
          // The list shifts under the cursor as games start and finish; keep
          // the selection on the board rather than pointing past the end.
          setIndex((value) => Math.min(value, Math.max(0, live.length - 1)));
        }
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      }

      if (!cancelled) {
        timer = setTimeout(() => void load(), LIST_POLL_MS);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [attempt]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || !games) {
      return;
    }

    switch (key.name) {
      case "up":
      case "k":
        setIndex((value) => Math.max(0, value - 1));
        break;
      case "down":
      case "j":
        setIndex((value) => Math.min(games.length - 1, value + 1));
        break;
      case "return":
      case "space": {
        const game = games[index];
        if (game) {
          onOpen(game.id);
        }
        break;
      }
      case "r":
        setAttempt((value) => value + 1);
        break;
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
      {error && !games ? (
        <ErrorNotice title="Couldn't load live games" message={error} />
      ) : !games ? (
        <text fg={theme.dim}>Looking for games…</text>
      ) : games.length === 0 ? (
        <text fg={theme.dim}>
          Nobody's playing right now. Start an online game and be the show.
        </text>
      ) : (
        <box flexDirection="column" width={WIDTH - 6}>
          <text>
            <span fg={theme.faint}>{"  Players".padEnd(PLAYERS_W)}</span>
            <span fg={theme.faint}>{"Clock".padEnd(SPEED_W)}</span>
            <span fg={theme.faint}>Moves</span>
          </text>

          {games.map((game, i) => {
            const active = i === index;
            const pairing = `${faceName(game.white)} vs ${faceName(game.black)}`;
            const ratings =
              game.whiteRating !== null && game.blackRating !== null
                ? `${game.whiteRating}/${game.blackRating}`
                : "—";

            return (
              <text key={game.id} bg={active ? theme.selectionBg : undefined}>
                <span fg={active ? theme.gold : theme.faint}>
                  {active ? "▸ " : "  "}
                </span>
                <span fg={active ? theme.cream : theme.text}>
                  {pairing.slice(0, PLAYERS_W - 2).padEnd(PLAYERS_W - 2)}
                </span>
                <span fg={theme.dim}>{speedLabel(game).padEnd(SPEED_W)}</span>
                <span fg={theme.dim}>
                  {`${Math.ceil(game.ply / 2)}  ${ratings}`}
                </span>
              </text>
            );
          })}
        </box>
      )}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "enter", label: "watch" },
          { key: "r", label: "refresh" },
        ]}
      />
    </GameScreen>
  );
}

function SpectatorBoard({
  gameId,
  onBack,
}: {
  gameId: string;
  onBack: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const [game, setGame] = useState<SpectatorGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  // The first state arrives on the stream, but a fetch gets something on
  // screen without waiting for the connection to come up.
  useEffect(() => {
    let cancelled = false;

    void fetchSpectatorGame(gameId)
      .then((state) => {
        if (!cancelled) {
          setGame((current) => current ?? state);
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
  }, [gameId]);

  const latest = useRef<SpectatorGame | null>(game);
  latest.current = game;

  useEffect(() => {
    return subscribeToSpectatorGame(gameId, {
      onState: (state) => {
        const current = latest.current;
        if (
          !current ||
          state.ply !== current.ply ||
          state.result !== current.result
        ) {
          setGame(state);
        }
      },
    });
  }, [gameId]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }
    if (key.name === "f") {
      setFlipped((value) => !value);
    }
  });

  const board = useReplayedGame(game?.history ?? []);
  const over = game?.result != null;

  // No `onExpire`: a watcher has no standing to settle anyone's game on time.
  // The players' own screens do that; this one just stops counting down.
  const live = useClock({ clock: game?.clock ?? null, over });

  const clocks = useMemo(
    () =>
      orientClocks({
        live,
        running: game?.clock?.running ?? "w",
        over,
        flipped,
        labelFor: (color: Color) =>
          color === "w" ? faceName(game?.white ?? null) : faceName(game?.black ?? null),
      }),
    [flipped, game?.black, game?.clock?.running, game?.white, live, over],
  );

  const handleEscape = useCallback(() => {
    onBack();
    return true;
  }, [onBack]);

  if (error) {
    return (
      <GameScreen
        title={TITLE}
        subtitle={SUBTITLE}
        width={WIDTH}
        onEscape={handleEscape}
      >
        <ErrorNotice
          title="Couldn't watch that game"
          message={error}
          hints={[{ key: "esc", label: "back" }]}
        />
      </GameScreen>
    );
  }

  if (!game) {
    return (
      <GameScreen
        title={TITLE}
        subtitle={SUBTITLE}
        width={WIDTH}
        onEscape={handleEscape}
      >
        <text fg={theme.dim}>Connecting…</text>
      </GameScreen>
    );
  }

  const lastMove = board.history[board.history.length - 1]?.move ?? null;
  const checkSquare =
    board.status === "check" || board.status === "checkmate"
      ? findKing(board.position.board, board.position.turn)
      : null;

  const status = (): string => {
    if (game.result === "ABORTED") {
      return "The game was aborted";
    }
    if (game.result !== null && board.status === "playing") {
      // A result on a live-looking position: someone resigned, ran out of time
      // or walked away.
      const winner = game.result === "WHITE_WIN" ? game.white : game.black;
      return `${faceName(winner)} wins`;
    }
    return describeStatus(board.status, board.position.turn);
  };

  return (
    <GameScreen
      title={`${TITLE} · ${faceName(game.white)} vs ${faceName(game.black)}`}
      width={WIDTH}
      onEscape={handleEscape}
      footer={
        <>
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
        </>
      }
    >
      {clocks ? <ClockLine row={clocks.top} /> : null}

      <box flexDirection="row" gap={2}>
        <Board
          board={board.position.board}
          cursor={-1}
          selected={null}
          targets={[]}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
        />
        <MoveList game={board} />
      </box>

      <CapturedSummary game={board} />

      {clocks ? <ClockLine row={clocks.bottom} /> : null}

      <text fg={over ? theme.gold : theme.dim}>{status()}</text>
    </GameScreen>
  );
}
