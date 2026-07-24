import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useLocation } from "react-router";
import {
  analyzePosition,
  buildGameReport,
  centipawnLoss,
  classifyMove,
  clampEval,
  createGame,
  findKing,
  mistakes,
  playSan,
  STARTING_FEN,
  toSan,
  EVAL_CLAMP,
} from "@openchess/shared";
import type {
  Analysis,
  AnalyzedPly,
  Color,
  Game,
  GameReport,
  MoveQuality,
} from "@openchess/shared";
import { ErrorNotice } from "../components/error-notice";
import { GameScreen } from "../components/game-screen";
import { HintBar } from "../components/hint-bar";
import { Board } from "../components/board";
import { MoveList } from "../components/game-panels";
import {
  listFinishedGames,
  fetchGame,
  type GameHistoryEntry,
  type ServerGame,
} from "../lib/games";
import { toEngineDifficulty } from "../lib/games";
import {
  DEFAULT_EXPORT_DIR,
  exportGamePgn,
  importPgnFile,
} from "../lib/pgn-files";
import { DIFFICULTY_LABELS } from "./ai-game/setup";
import { useAuth } from "../providers/auth";
import { useKeyboardLayer, BASE_LAYER_ID } from "../providers/keyboard-layer";
import { useUITheme } from "../providers/theme";
import { errorMessage } from "../lib/utils";

const TITLE = "Analysis";
const SUBTITLE = "Step through a finished game with the engine";
const WIDTH = 62;

/**
 * Everything the review board needs, whichever way the game got here — off the
 * server, or out of a PGN file. Keeping the board blind to the difference is
 * what lets an imported game get the same treatment as one you played.
 */
type ReviewSource = {
  /** The moves in SAN. */
  history: string[];
  startingFen: string;
  /** Which way up to draw the board. */
  orientation: Color;
  subtitle: string;
  /** Present only for a game the server holds, which is what can be exported. */
  gameId: string | null;
};

/**
 * The review screen. Reached from the menu — which lists your finished games to
 * pick from — or straight from a game that just ended, which passes its id in
 * the navigation state so the board opens on it.
 */
export function Analysis() {
  const auth = useAuth();
  const theme = useUITheme();
  const location = useLocation();

  const initialGameId =
    (location.state as { gameId?: string } | null)?.gameId ?? null;
  const [selected, setSelected] = useState<string | null>(initialGameId);
  /** A game read out of a PGN file, which needs no account at all. */
  const [imported, setImported] = useState<ReviewSource | null>(null);
  const [importing, setImporting] = useState(false);

  const back = useCallback(() => {
    setSelected(null);
    setImported(null);
  }, []);

  if (importing) {
    return (
      <ImportPgn
        onCancel={() => setImporting(false)}
        onImported={(source) => {
          setImporting(false);
          setImported(source);
        }}
      />
    );
  }

  if (imported) {
    return <ReviewBoard source={imported} onBack={back} />;
  }

  if (auth.status === "checking") {
    return (
      <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
        <text fg={theme.dim}>Checking your session…</text>
      </GameScreen>
    );
  }

  // Importing is the one thing here that works signed out: the file is the
  // whole game, and the engine that reviews it is running locally anyway.
  if (auth.status !== "signed-in") {
    return (
      <SignedOutAnalysis onImport={() => setImporting(true)} />
    );
  }

  return selected ? (
    <Review gameId={selected} onBack={back} />
  ) : (
    <History onOpen={setSelected} onImport={() => setImporting(true)} />
  );
}

function SignedOutAnalysis({ onImport }: { onImport: () => void }) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  useKeyboard((key) => {
    if (isTopLayer(BASE_LAYER_ID) && key.name === "i") {
      onImport();
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
      <box flexDirection="column" alignItems="center" gap={1}>
        <text fg={theme.gold}>Analysis needs an account</text>
        <text fg={theme.dim}>
          Your finished games live on the server; sign in to review them.
        </text>
        <text fg={theme.dim}>
          A PGN file needs no account — the engine runs here.
        </text>
      </box>

      <HintBar hints={[{ key: "i", label: "import a PGN" }]} />
    </GameScreen>
  );
}

/** Your finished games, newest first; pick one to review. */
function History({
  onOpen,
  onImport,
}: {
  onOpen: (gameId: string) => void;
  onImport: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const [games, setGames] = useState<GameHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void listFinishedGames()
      .then((page) => {
        if (!cancelled) {
          setGames(page.games);
          setCursor(page.nextCursor);
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
  }, [attempt]);

  const loadMore = useCallback(() => {
    if (cursor === null) {
      return;
    }
    void listFinishedGames({ cursor })
      .then((page) => {
        setGames((prev) => [...(prev ?? []), ...page.games]);
        setCursor(page.nextCursor);
      })
      .catch((cause) => setError(errorMessage(cause)));
  }, [cursor]);

  /** Write the highlighted game out as PGN, without leaving the list. */
  const exportSelected = useCallback(async () => {
    const game = games?.[index];
    if (!game) {
      return;
    }

    setNote("Exporting…");
    try {
      const { path } = await exportGamePgn(game.id);
      setNote(`Saved to ${path}`);
    } catch (cause) {
      setNote(errorMessage(cause));
    }
  }, [games, index]);

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
      case "j": {
        const next = Math.min(games.length - 1, index + 1);
        setIndex(next);
        // Fetch the next page as the selection nears the end of the list.
        if (next >= games.length - 2) {
          loadMore();
        }
        break;
      }
      case "return":
      case "space": {
        const game = games[index];
        if (game) {
          onOpen(game.id);
        }
        break;
      }
      case "e":
        void exportSelected();
        break;
      case "i":
        onImport();
        break;
      case "r":
        setIndex(0);
        setNote(null);
        setAttempt((value) => value + 1);
        break;
    }
  });

  return (
    <GameScreen title={TITLE} subtitle={SUBTITLE} width={WIDTH}>
      {error ? (
        <ErrorNotice title="Couldn't load your games" message={error} />
      ) : !games ? (
        <text fg={theme.dim}>Loading…</text>
      ) : games.length === 0 ? (
        <text fg={theme.dim}>
          No finished games yet — play one, then come back to review it.
        </text>
      ) : (
        <HistoryTable games={games} index={index} />
      )}

      {note ? <text fg={theme.gold}>{note}</text> : null}

      <HintBar
        hints={[
          { key: "↑↓", label: "browse" },
          { key: "enter", label: "review" },
          { key: "e", label: "export PGN" },
          { key: "i", label: "import" },
          { key: "r", label: "refresh" },
        ]}
      />
    </GameScreen>
  );
}

/** Column widths for the games table. */
const WHEN_W = 12;
const KIND_W = 18;
const RESULT_W = 12;

function historyResult(entry: GameHistoryEntry): string {
  if (entry.result === null) {
    return "Unfinished";
  }
  if (entry.result === "DRAW") {
    return "Draw";
  }
  if (entry.result === "ABORTED") {
    return "Aborted";
  }
  const youWon = (entry.result === "WHITE_WIN") === (entry.yourColor === "w");
  return youWon ? "Won" : "Lost";
}

function historyKind(entry: GameHistoryEntry): string {
  if (entry.mode === "AI") {
    const label = DIFFICULTY_LABELS[toEngineDifficulty(entry.difficulty)];
    return `vs Engine (${label})`;
  }
  return "Online 1v1";
}

function HistoryTable({
  games,
  index,
}: {
  games: GameHistoryEntry[];
  index: number;
}) {
  const theme = useUITheme();

  return (
    <box flexDirection="column" width={WIDTH - 6}>
      <text>
        <span fg={theme.faint}>{"When".padEnd(WHEN_W)}</span>
        <span fg={theme.faint}>{"Game".padEnd(KIND_W)}</span>
        <span fg={theme.faint}>{"Result".padEnd(RESULT_W)}</span>
        <span fg={theme.faint}>Moves</span>
      </text>

      {games.map((entry, i) => {
        const active = i === index;
        const fg = active ? theme.cream : theme.text;
        const when = entry.endedAt
          ? new Date(entry.endedAt).toLocaleDateString()
          : "—";
        const moves = Math.ceil(entry.ply / 2);

        return (
          <text key={entry.id} bg={active ? theme.selectionBg : undefined}>
            <span fg={active ? theme.gold : theme.faint}>
              {active ? "▸ " : "  "}
            </span>
            <span fg={theme.dim}>{when.padEnd(WHEN_W - 2)}</span>
            <span fg={fg}>{historyKind(entry).padEnd(KIND_W)}</span>
            <span fg={fg}>{historyResult(entry).padEnd(RESULT_W)}</span>
            <span fg={theme.dim}>{String(moves)}</span>
          </text>
        );
      })}
    </box>
  );
}

/** Read a game out of a PGN file on disk. */
function ImportPgn({
  onImported,
  onCancel,
}: {
  onImported: (source: ReviewSource) => void;
  onCancel: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const inputRef = useRef<InputRenderable>(null);
  const [path, setPath] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (path.trim() === "") {
      return;
    }

    setPending(true);
    setMessage(null);

    try {
      const { game, total } = await importPgnFile(path);
      const white = game.tags.white ?? "White";
      const black = game.tags.black ?? "Black";

      onImported({
        history: game.moves,
        startingFen: game.startingFen,
        orientation: "w",
        subtitle: `${white} vs ${black} · ${game.result}${
          total > 1 ? ` · game 1 of ${total}` : ""
        }`,
        gameId: null,
      });
    } catch (cause) {
      setMessage(errorMessage(cause));
      setPending(false);
    }
  }, [onImported, path]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID) || pending) {
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      void load();
    }
  });

  return (
    <GameScreen
      title="Import a PGN"
      subtitle="Review a game that was never played here"
      width={WIDTH}
      onEscape={() => {
        onCancel();
        return true;
      }}
    >
      <box flexDirection="column" width={WIDTH - 6} gap={1}>
        <input
          ref={inputRef}
          placeholder={`path to a .pgn file (exports land in ${DEFAULT_EXPORT_DIR})`}
          focused
          onContentChange={() => setPath(inputRef.current?.value ?? "")}
        />
        {message ? <text fg={theme.gold}>{message}</text> : null}
        {pending ? <text fg={theme.dim}>Reading…</text> : null}
      </box>

      <HintBar
        hints={[
          { key: "enter", label: "open" },
          { key: "esc", label: "cancel" },
        ]}
      />
    </GameScreen>
  );
}

/** Rebuild every intermediate position: `frames[i]` is the game after i plies. */
function buildFrames(history: string[], startingFen: string): Game[] {
  const frames: Game[] = [createGame(startingFen)];
  let game = frames[0]!;
  for (const san of history) {
    game = playSan(game, san);
    frames.push(game);
  }
  return frames;
}

/**
 * Evaluate every position in the game, a couple per tick so the board stays
 * responsive while the search runs. Returns the analyses filled in so far and
 * how many are done, for a progress line.
 */
function useGameAnalysis(frames: Game[]): {
  analyses: Array<Analysis | null>;
  done: number;
} {
  const [analyses, setAnalyses] = useState<Array<Analysis | null>>(() =>
    frames.map(() => null),
  );

  useEffect(() => {
    setAnalyses(frames.map(() => null));

    let cancelled = false;
    let next = 0;
    const BATCH = 2;

    const step = () => {
      if (cancelled) {
        return;
      }

      const batch: Array<{ index: number; analysis: Analysis }> = [];
      for (let n = 0; n < BATCH && next < frames.length; n += 1, next += 1) {
        batch.push({ index: next, analysis: analyzePosition(frames[next]!.position) });
      }

      if (batch.length > 0) {
        setAnalyses((prev) => {
          const updated = prev.slice();
          for (const item of batch) {
            updated[item.index] = item.analysis;
          }
          return updated;
        });
      }

      if (next < frames.length) {
        setTimeout(step, 0);
      }
    };

    const timer = setTimeout(step, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [frames]);

  const done = analyses.filter((entry) => entry !== null).length;
  return { analyses, done };
}

/**
 * The game report, over as much of the game as has been evaluated.
 *
 * Built from the prefix rather than waiting for the whole search: the analyses
 * arrive in order, so a partial report is the report of the opening, and
 * showing it while the rest fills in beats showing nothing for ten seconds.
 */
function useGameReport(
  frames: Game[],
  analyses: Array<Analysis | null>,
  history: string[],
): GameReport {
  return useMemo(() => {
    const plies: AnalyzedPly[] = [];

    for (let ply = 1; ply < frames.length; ply += 1) {
      const before = analyses[ply - 1];
      const after = analyses[ply];

      // The first gap ends the report: everything past it is unevaluated.
      if (!before || !after) {
        break;
      }

      plies.push({
        mover: frames[ply - 1]!.position.turn,
        san: history[ply - 1] ?? "",
        before: before.scoreCp,
        after: after.scoreCp,
        mateInvolved: before.mateIn !== null || after.mateIn !== null,
      });
    }

    return buildGameReport(plies);
  }, [analyses, frames, history]);
}

const QUALITY_LABEL: Record<MoveQuality, string> = {
  best: "Best move",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

/** Centipawns clamped to a pawn axis for the eval bar. */
const BAR_W = 24;

/** A signed pawn reading, or mate notation, from white's point of view. */
function formatEval(analysis: Analysis): string {
  if (analysis.mateIn !== null) {
    if (analysis.mateIn === 0) {
      return "#";
    }
    return `${analysis.mateIn > 0 ? "" : "-"}M${Math.abs(analysis.mateIn)}`;
  }
  const pawns = analysis.scoreCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

/** White's share of the eval bar, 0 (black winning) to 1 (white winning). */
function whiteShare(analysis: Analysis): number {
  if (analysis.mateIn !== null) {
    return analysis.scoreCp >= 0 ? 1 : 0;
  }
  return 0.5 + clampEval(analysis.scoreCp) / (2 * EVAL_CLAMP);
}

function subtitleFor(game: ServerGame): string {
  const kind =
    game.mode === "AI"
      ? `vs Engine (${DIFFICULTY_LABELS[toEngineDifficulty(game.difficulty)]})`
      : `vs ${game.opponent?.username ?? "your opponent"}`;

  let outcome = "unfinished";
  if (game.result === "DRAW") {
    outcome = "drawn";
  } else if (game.result === "ABORTED") {
    outcome = "aborted";
  } else if (game.result !== null) {
    const youWon = (game.result === "WHITE_WIN") === (game.yourColor === "w");
    outcome = youWon ? "you won" : "you lost";
  }

  return `${kind} · ${outcome}`;
}

function Review({
  gameId,
  onBack,
}: {
  gameId: string;
  onBack: () => void;
}) {
  const theme = useUITheme();

  const [game, setGame] = useState<ServerGame | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void fetchGame(gameId)
      .then((state) => {
        if (!cancelled) {
          setGame(state);
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

  if (error) {
    return (
      <GameScreen
        title={TITLE}
        subtitle={SUBTITLE}
        width={WIDTH}
        onEscape={() => {
          onBack();
          return true;
        }}
      >
        <ErrorNotice
          title="Couldn't load that game"
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
        onEscape={() => {
          onBack();
          return true;
        }}
      >
        <text fg={theme.dim}>Loading the game…</text>
      </GameScreen>
    );
  }

  return (
    <ReviewBoard
      source={{
        history: game.history,
        // Every server game starts from the initial array; the record format
        // has no room for anything else.
        startingFen: STARTING_FEN,
        orientation: game.yourColor,
        subtitle: subtitleFor(game),
        gameId: game.id,
      }}
      onBack={onBack}
    />
  );
}

function ReviewBoard({
  source,
  onBack,
}: {
  source: ReviewSource;
  onBack: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  // Stable across ticks so the analysis effect does not restart every render.
  const frames = useMemo(
    () => buildFrames(source.history, source.startingFen),
    [source.history, source.startingFen],
  );
  const { analyses, done } = useGameAnalysis(frames);
  const report = useGameReport(frames, analyses, source.history);

  const lastPly = frames.length - 1;
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(source.orientation === "b");
  const [note, setNote] = useState<string | null>(null);

  /** Step to the next mistake in `direction`, or say there isn't one. */
  const jumpToMistake = useCallback(
    (direction: 1 | -1) => {
      const marks = mistakes(report);

      if (marks.length === 0) {
        setNote(
          done < frames.length
            ? "Still looking — no mistakes found yet"
            : "No mistakes to jump to",
        );
        return;
      }

      const next =
        direction === 1
          ? marks.find((mark) => mark.ply > ply)
          : [...marks].reverse().find((mark) => mark.ply < ply);

      if (!next) {
        setNote(direction === 1 ? "That was the last one" : "That was the first one");
        return;
      }

      setNote(null);
      setPly(next.ply);
    },
    [done, frames.length, ply, report],
  );

  const exportPgn = useCallback(async () => {
    if (source.gameId === null) {
      setNote("This game came from a file — it's already on disk");
      return;
    }

    setNote("Exporting…");
    try {
      const { path } = await exportGamePgn(source.gameId);
      setNote(`Saved to ${path}`);
    } catch (cause) {
      setNote(errorMessage(cause));
    }
  }, [source.gameId]);

  useKeyboard((key) => {
    if (!isTopLayer(BASE_LAYER_ID)) {
      return;
    }

    switch (key.name) {
      case "left":
      case "h":
        setPly((value) => Math.max(0, value - 1));
        break;
      case "right":
      case "l":
        setPly((value) => Math.min(lastPly, value + 1));
        break;
      case "home":
        setPly(0);
        break;
      case "end":
        setPly(lastPly);
        break;
      case "g":
        setPly(key.shift ? lastPly : 0);
        break;
      case "f":
        setFlipped((value) => !value);
        break;
      case "n":
        jumpToMistake(1);
        break;
      case "p":
        jumpToMistake(-1);
        break;
      case "e":
        void exportPgn();
        break;
    }
  });

  const frame = frames[ply]!;
  const { position, status } = frame;
  const analysis = analyses[ply] ?? null;

  const lastMove = frame.history[frame.history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  // The quality of the move that reached this position, once both the position
  // before it and this one have been evaluated.
  const before = ply > 0 ? analyses[ply - 1] : null;
  const moved = ply > 0 ? source.history[ply - 1] ?? null : null;
  let quality: { label: string; loss: number | null } | null = null;
  if (ply > 0 && before && analysis) {
    const mover = frames[ply - 1]!.position.turn;
    // Clamp mate scores onto the pawn axis before comparing: throwing away a
    // forced mate for a merely-winning position is a mistake, not the
    // hundred-pawn "blunder" the raw mate score would read as.
    const loss = centipawnLoss(
      mover,
      clampEval(before.scoreCp),
      clampEval(analysis.scoreCp),
    );
    const mateInvolved = before.mateIn !== null || analysis.mateIn !== null;
    quality = {
      label: QUALITY_LABEL[classifyMove(loss)],
      loss: mateInvolved ? null : loss,
    };
  }

  const bestSan =
    analysis && analysis.bestMove
      ? toSan(position, analysis.bestMove, frame.legalMoves)
      : null;

  return (
    <GameScreen
      title={TITLE}
      subtitle={source.subtitle}
      width={WIDTH}
      onEscape={() => {
        onBack();
        return true;
      }}
      footer={
        <>
          <span fg={theme.cream}>←→</span>
          <span fg={theme.faint}> step </span>
          <span fg={theme.cream}>n/p</span>
          <span fg={theme.faint}> mistakes </span>
          <span fg={theme.cream}>e</span>
          <span fg={theme.faint}> export </span>
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
        </>
      }
    >
      <box flexDirection="row" gap={2}>
        <Board
          board={position.board}
          cursor={-1}
          selected={null}
          targets={[]}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
        />
        <MoveList game={frame} />
      </box>

      <EvalBar analysis={analysis} />

      <AccuracyRow report={report} />

      <box flexDirection="column" width={WIDTH - 6}>
        <text>
          <span fg={theme.faint}>Move </span>
          <span fg={theme.cream}>{`${ply}/${lastPly}`}</span>
          {moved ? (
            <>
              <span fg={theme.faint}>{"  ·  "}</span>
              <span fg={theme.text}>{moved}</span>
            </>
          ) : (
            <span fg={theme.faint}>{"  ·  starting position"}</span>
          )}
        </text>

        {quality ? (
          <text>
            <span fg={theme.faint}>Quality: </span>
            <span fg={theme.gold}>{quality.label}</span>
            {quality.loss !== null && quality.loss > 0 ? (
              <span fg={theme.dim}>{`  (-${(quality.loss / 100).toFixed(1)})`}</span>
            ) : null}
          </text>
        ) : (
          <text fg={theme.faint}> </text>
        )}

        <text>
          <span fg={theme.faint}>Engine likes: </span>
          {bestSan ? (
            <span fg={theme.walnut}>{bestSan}</span>
          ) : (
            <span fg={theme.faint}>{analysis ? "—" : "…"}</span>
          )}
        </text>
      </box>

      {note ? <text fg={theme.gold}>{note}</text> : null}

      {done < frames.length ? (
        <text fg={theme.faint}>{`Analyzing… ${done}/${frames.length}`}</text>
      ) : null}
    </GameScreen>
  );
}

/**
 * How each side played, over the whole game: an accuracy percentage and the
 * count of what went wrong. This is the line a review opens with — the move by
 * move detail is what you read after it has told you where to look.
 */
function AccuracyRow({ report }: { report: GameReport }) {
  const theme = useUITheme();

  const side = (label: string, stats: GameReport["white"]) => {
    const bad =
      stats.counts.inaccuracy + stats.counts.mistake + stats.counts.blunder;

    return (
      <text>
        <span fg={theme.faint}>{`${label} `}</span>
        <span fg={theme.cream}>{`${stats.accuracy.toFixed(0)}%`}</span>
        <span fg={theme.faint}>{`  ${Math.round(stats.averageLoss)}cp`}</span>
        {bad > 0 ? (
          <span fg={theme.gold}>{`  ${stats.counts.blunder}?? ${stats.counts.mistake}? ${stats.counts.inaccuracy}!?`}</span>
        ) : null}
      </text>
    );
  };

  return (
    <box flexDirection="row" width={WIDTH - 6} justifyContent="space-between">
      {side("White", report.white)}
      {side("Black", report.black)}
    </box>
  );
}

/** The advantage bar: white's share of it grows as white leads. */
function EvalBar({ analysis }: { analysis: Analysis | null }) {
  const theme = useUITheme();

  if (!analysis) {
    return (
      <box flexDirection="row" width={WIDTH - 6} gap={1}>
        <text fg={theme.faint}>{"·".repeat(BAR_W)}</text>
        <text fg={theme.faint}>…</text>
      </box>
    );
  }

  const whiteCells = Math.round(whiteShare(analysis) * BAR_W);
  const blackCells = BAR_W - whiteCells;

  return (
    <box flexDirection="row" width={WIDTH - 6} gap={1}>
      <text>
        <span fg={theme.cream}>{"█".repeat(whiteCells)}</span>
        <span fg={theme.walnut}>{"█".repeat(blackCells)}</span>
      </text>
      <text fg={theme.gold}>{formatEval(analysis)}</text>
    </box>
  );
}
