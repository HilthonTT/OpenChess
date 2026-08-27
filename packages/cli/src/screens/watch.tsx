import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chatPhrasesFor,
  findKing,
  SPECTATOR_PHRASE_LIST,
  timeControlFor,
  type ChatPhraseId,
  type Color,
} from "@openchess/shared";
import { useKeyboard } from "@opentui/react";
import { Board } from "../components/board";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import {
  CapturedSummary,
  MoveList,
  describeStatus,
} from "../components/game-panels";
import { HintBar } from "../components/hint-bar";
import { ChatLog, PhrasePicker } from "../components/chat-panel";
import { ClockLine, orientClocks } from "../components/match-view";
import { SignedOut } from "../components/signed-out";
import { copyFen, copyPgn, serverPgnDetails } from "../lib/copy-game";
import { subscribeToSpectatorGame } from "../lib/game-events";
import {
  fetchSpectatorGame,
  listLiveGames,
  sendSpectatorChatMessage,
  type LiveGame,
  type SpectatorGame,
} from "../lib/spectate";
import { errorMessage } from "../lib/utils";
import { useClock } from "../hooks/use-clock";
import { useReplayedGame } from "../hooks/use-replayed-game";
import { useAuth } from "../providers/auth";
import { BASE_LAYER_ID, useKeyboardLayer } from "../providers/keyboard-layer";
import { useKeymap, type Keymap } from "../providers/keymap";
import { COPY_KEYS } from "../lib/keymaps";
import { useUITheme } from "../providers/theme";

const TITLE = "Watch";
const SUBTITLE = "Games being played right now";
const WIDTH = 58;

const LIST_KEYMAP: Keymap = {
  title: "Watch — games in progress",
  sections: [
    {
      keys: [
        { keys: "↑↓", label: "browse" },
        { keys: "enter", label: "watch the highlighted game" },
        { keys: "r", label: "refresh" },
      ],
    },
  ],
};

const BOARD_KEYMAP: Keymap = {
  title: "Watch — spectating",
  escape: "back to the list",
  sections: [
    {
      keys: [
        { keys: "f", label: "flip the board" },
        // Not held back to the end as it is on your own board: this is
        // somebody else's game, and a watcher has no move to be helped with.
        ...COPY_KEYS,
      ],
    },
    {
      title: "The gallery",
      keys: [
        { keys: "t", label: "say one of nine phrases" },
        { keys: "1-9", label: "pick one, while the picker is open" },
        {
          keys: "",
          label:
            "the two players never see any of it, and you never see theirs",
        },
      ],
    },
  ],
};

/**
 * The layer the phrase picker takes while it is open, so `f` and `y` go quiet
 * underneath it and the digits are unambiguously the picker's.
 */
const CHAT_LAYER_ID = "watch-chat";

/** The newest message's id, or "" — how a client tells one transcript from another. */
function lastMessageId(game: { chat: { id: string }[] }): string {
  return game.chat.at(-1)?.id ?? "";
}

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
  const [watching, setWatching] = useState<string | null>(null);

  if (auth.status !== "signed-in") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <SignedOut
          title="Watching needs an account"
          message="Live games come down the server's stream."
        />
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

  useKeymap(LIST_KEYMAP);

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
  const { push: pushLayer, pop: popLayer, isTopLayer } = useKeyboardLayer();

  useKeymap(BOARD_KEYMAP);

  const [game, setGame] = useState<SpectatorGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);
  /** What the last copy did, under the status line. */
  const [note, setNote] = useState<string | null>(null);
  /** The phrase picker is open and taking the digits. */
  const [saying, setSaying] = useState(false);

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
        // A draw offer moves neither the ply nor the result, so it is named here
        // as well — otherwise a change that is pure negotiation is filtered out
        // as "nothing new" and the watcher never sees it. A takeback request is
        // the same; the takeback itself moves the ply, backwards, and needs no
        // naming of its own.
        if (
          !current ||
          state.ply !== current.ply ||
          state.result !== current.result ||
          state.drawOfferFrom !== current.drawOfferFrom ||
          state.takebackOfferFrom !== current.takebackOfferFrom
        ) {
          setGame(state);
          return;
        }

        // A message moves nothing on the board, so it takes the narrow path:
        // the transcript is copied across and everything else — the flipped
        // orientation, the copy note — is left exactly where it was.
        if (lastMessageId(state) !== lastMessageId(current)) {
          setGame((previous) =>
            previous ? { ...previous, chat: state.chat } : state,
          );
        }
      },
    });
  }, [gameId]);

  const board = useReplayedGame(game?.history ?? [], game?.startFen ?? null);
  const over = game?.result != null;

  /**
   * The watchers' nine, led by the ones that fit where the game is.
   *
   * A different catalog from the players' — a watcher is commenting rather than
   * playing, and half of what the two of them can say to each other reads as
   * somebody else's line when it comes from the gallery.
   */
  const phrases = useMemo(
    () =>
      chatPhrasesFor(
        over ? "end" : (game?.ply ?? 0) < 2 ? "start" : "any",
        SPECTATOR_PHRASE_LIST,
      ),
    [game?.ply, over],
  );

  /**
   * Say one of them to the rest of the gallery.
   *
   * Nothing on this screen is locked while it is in flight: a watcher has no
   * move to be held up, and the board keeps arriving from the stream either
   * way.
   */
  const say = useCallback(
    async (phrase: ChatPhraseId) => {
      setSaying(false);

      try {
        const chat = await sendSpectatorChatMessage(gameId, phrase);
        setGame((previous) => (previous ? { ...previous, chat } : previous));
      } catch (cause) {
        setNote(errorMessage(cause));
      }
    },
    [gameId],
  );

  // The picker owns the keyboard while it is open, which is what lets it bind
  // the digits without the screen underneath having to know they are spoken for.
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

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }
    if (key.name === "f") {
      setFlipped((value) => !value);
    }
    if (key.name === "t") {
      setSaying(true);
    }
    // Copying is not held back to the end here as it is on a player's own
    // board: this is a public game somebody else is playing, and the watcher
    // has no move to be helped with.
    if (key.name === "y" && game) {
      setNote(
        key.shift
          ? copyPgn(
              board,
              serverPgnDetails({
                event: "OpenChess online game",
                startedAt: game.startedAt,
                result: game.result,
                white: faceName(game.white),
                black: faceName(game.black),
              }),
            )
          : copyFen(board),
      );
    }
  });

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
          color === "w"
            ? faceName(game?.white ?? null)
            : faceName(game?.black ?? null),
      }),
    [flipped, game?.black, game?.clock?.running, game?.white, live, over],
  );

  // No branch for the open picker: while it is up it holds the keyboard layer,
  // and `GameScreen` only reads escape on the base one. Escape closes the
  // picker, and the press after that is the one that leaves the game.
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
    // A draw on a live-looking position was agreed rather than played out —
    // checked ahead of the decisive case below, which has no winner to name.
    if (game.result === "DRAW" && board.status === "playing") {
      return "Draw agreed";
    }
    if (game.result !== null && board.status === "playing") {
      // A result on a live-looking position: someone resigned, ran out of time
      // or walked away.
      const winner = game.result === "WHITE_WIN" ? game.white : game.black;
      return `${faceName(winner)} wins`;
    }
    // Part of what is happening on the board, like the clock: a watcher who
    // cannot see the offer cannot read the next move.
    if (game.takebackOfferFrom !== null) {
      const asker = game.takebackOfferFrom === "w" ? game.white : game.black;
      return `${faceName(asker)} has asked for their move back`;
    }
    if (game.drawOfferFrom !== null) {
      const offerer = game.drawOfferFrom === "w" ? game.white : game.black;
      return `${faceName(offerer)} has offered a draw`;
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
          <span fg={theme.cream}>y</span>
          <span fg={theme.faint}> copy </span>
          <span fg={theme.cream}>t</span>
          <span fg={theme.faint}> say </span>
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

      {/* The gallery, never the players. What the two of them are saying to
          each other is not on this payload at all. */}
      {saying ? (
        <PhrasePicker
          phrases={phrases}
          title="Say something to the gallery — esc to close"
        />
      ) : (
        <ChatLog
          messages={game.chat}
          nameFor={(message) => (message.mine ? "you" : message.username)}
        />
      )}

      {note ? <text fg={theme.gold}>{note}</text> : null}
    </GameScreen>
  );
}
