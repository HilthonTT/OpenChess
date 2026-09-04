import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useKeyboard } from "@opentui/react";
import {
  centipawnLoss,
  classifyMove,
  clampEval,
  findKing,
  formatLine,
  mistakes,
  openingOf,
  STARTING_FEN,
  toSan,
  EVAL_CLAMP,
} from "@openchess/shared";
import type {
  Analysis as PositionAnalysis,
  GameReport,
  MoveQuality,
} from "@openchess/shared";
import { ErrorNotice } from "../../components/error-notice";
import { GameScreen } from "../../components/game-screen";
import { Board } from "../../components/board";
import { MoveList } from "../../components/game-panels";
import { fetchGame, type ServerGame } from "../../lib/games";
import { exportGamePgn } from "../../lib/pgn-files";
import {
  copyFen,
  copyPgn,
  serverPgnDetails,
  type PgnDetails,
} from "../../lib/copy-game";

import { useAuth } from "../../providers/auth";
import {
  useKeyboardLayer,
  BASE_LAYER_ID,
} from "../../providers/keyboard-layer";
import { useUITheme } from "../../providers/theme";
import { errorMessage } from "../../lib/utils";

import {
  buildFrames,
  useDeepAnalysis,
  useGameAnalysis,
  useGameReport,
} from "./engine";
import type { ReviewSource } from "./import-pgn";
import { SUBTITLE, TITLE, WIDTH } from "./keymaps";
import { botName } from "./history";

const QUALITY_LABEL: Record<MoveQuality, string> = {
  best: "Best move",
  good: "Good",
  inaccuracy: "Inaccuracy",
  mistake: "Mistake",
  blunder: "Blunder",
};

const BAR_H = 17;

const MARKS: Partial<Record<MoveQuality, string>> = {
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

function formatEval(analysis: PositionAnalysis): string {
  if (analysis.mateIn !== null) {
    if (analysis.mateIn === 0) {
      return "#";
    }
    return `${analysis.mateIn > 0 ? "" : "-"}M${Math.abs(analysis.mateIn)}`;
  }
  const pawns = analysis.scoreCp / 100;
  return `${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`;
}

function whiteShare(analysis: PositionAnalysis): number {
  if (analysis.mateIn !== null) {
    return analysis.scoreCp >= 0 ? 1 : 0;
  }
  return 0.5 + clampEval(analysis.scoreCp) / (2 * EVAL_CLAMP);
}

function subtitleFor(game: ServerGame): string {
  const kind =
    game.mode === "AI"
      ? `vs ${botName(game.personality)}${
          game.variant === "CHESS960" ? " · Chess960" : ""
        }`
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

function pgnDetailsFor(game: ServerGame, you: string): PgnDetails {
  const them =
    game.mode === "AI"
      ? `OpenChess ${botName(game.personality)}`
      : (game.opponent?.username ?? "?");

  return serverPgnDetails({
    event: game.mode === "AI" ? "OpenChess AI game" : "OpenChess online game",
    startedAt: game.startedAt,
    result: game.result,
    white: game.yourColor === "w" ? you : them,
    black: game.yourColor === "b" ? you : them,
  });
}

export function Review({
  gameId,
  onBack,
}: {
  gameId: string;
  onBack: () => void;
}) {
  const auth = useAuth();
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
        startingFen: game.startFen ?? STARTING_FEN,
        orientation: game.yourColor,
        subtitle: subtitleFor(game),
        gameId: game.id,
        pgn: pgnDetailsFor(game, auth.profile?.username ?? "You"),
      }}
      onBack={onBack}
    />
  );
}

export function ReviewBoard({
  source,
  onBack,
}: {
  source: ReviewSource;
  onBack: () => void;
}) {
  const theme = useUITheme();
  const { isTopLayer } = useKeyboardLayer();

  const frames = useMemo(
    () => buildFrames(source.history, source.startingFen),
    [source.history, source.startingFen],
  );
  const { analyses, done, refine } = useGameAnalysis(frames);
  const report = useGameReport(frames, analyses, source.history);

  const lastPly = frames.length - 1;
  const [ply, setPly] = useState(0);
  const [flipped, setFlipped] = useState(source.orientation === "b");
  const [note, setNote] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [showLine, setShowLine] = useState(true);

  const frame = frames[ply]!;
  const { thinking } = useDeepAnalysis(frame, deep, (result) =>
    refine(ply, result),
  );

  const marks = useMemo(() => {
    const map = new Map<number, string>();
    for (const entry of report.plies) {
      const mark = MARKS[entry.quality];
      if (mark) {
        map.set(entry.ply, mark);
      }
    }
    return map;
  }, [report]);

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
        setNote(
          direction === 1 ? "That was the last one" : "That was the first one",
        );
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
      case "a":
        setDeep((value) => !value);
        break;
      case "b":
        setShowLine((value) => !value);
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
      case "y":
        setNote(
          key.shift
            ? copyPgn(frames[lastPly]!, source.pgn)
            : copyFen(frames[ply]!),
        );
        break;
    }
  });

  const { position, status } = frame;
  const analysis = analyses[ply] ?? null;

  const lastMove = frame.history[frame.history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  const before = ply > 0 ? analyses[ply - 1] : null;
  const moved = ply > 0 ? (source.history[ply - 1] ?? null) : null;
  let quality: { label: string; loss: number | null } | null = null;
  if (ply > 0 && before && analysis) {
    const mover = frames[ply - 1]!.position.turn;
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

  const bestSan = analysis?.bestMove
    ? toSan(position, analysis.bestMove, frame.legalMoves)
    : null;
  const bestLine = analysis ? formatLine(position, analysis.line) : "";
  const arrows = showLine && analysis ? analysis.line.slice(0, 2) : [];

  const opening = openingOf(frame);

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
          <span fg={theme.cream}>a</span>
          <span fg={theme.faint}> deeper </span>
          <span fg={theme.cream}>b</span>
          <span fg={theme.faint}> line </span>
          <span fg={theme.cream}>e</span>
          <span fg={theme.faint}> export </span>
          <span fg={theme.cream}>y</span>
          <span fg={theme.faint}> copy </span>
          <span fg={theme.cream}>f</span>
          <span fg={theme.faint}> flip </span>
        </>
      }
    >
      <box flexDirection="row" gap={1}>
        <EvalBar analysis={analysis} flipped={flipped} />
        <Board
          board={position.board}
          cursor={-1}
          selected={null}
          targets={[]}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
          arrows={arrows}
        />
        <MoveList game={frame} marks={marks} />
      </box>

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
              <span
                fg={theme.dim}
              >{`  (-${(quality.loss / 100).toFixed(1)})`}</span>
            ) : null}
          </text>
        ) : (
          <text fg={theme.faint}> </text>
        )}

        <text>
          <span fg={theme.faint}>Best line: </span>
          {bestSan ? (
            <>
              <span fg={theme.walnut}>{bestLine.slice(0, WIDTH - 24)}</span>
              <span fg={theme.faint}>
                {`  d${analysis?.depth ?? 0}${thinking ? " thinking…" : deep ? " ✓" : ""}`}
              </span>
            </>
          ) : (
            <span fg={theme.faint}>{analysis ? "—" : "…"}</span>
          )}
        </text>

        <text>
          <span fg={theme.faint}>Opening: </span>
          {opening ? (
            <>
              <span fg={theme.gold}>{opening.name}</span>
              <span fg={theme.faint}>{` (${opening.eco})`}</span>
            </>
          ) : (
            <span fg={theme.faint}>—</span>
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
          <span
            fg={theme.gold}
          >{`  ${stats.counts.blunder}?? ${stats.counts.mistake}? ${stats.counts.inaccuracy}!?`}</span>
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

function EvalBar({
  analysis,
  flipped,
}: {
  analysis: PositionAnalysis | null;
  flipped: boolean;
}) {
  const theme = useUITheme();

  const rows: ReactNode[] = [];
  if (!analysis) {
    for (let row = 0; row < BAR_H; row += 1) {
      rows.push(
        <text key={row} fg={theme.faint}>
          {" ·· "}
        </text>,
      );
    }
  } else {
    const whiteCells = Math.round(whiteShare(analysis) * BAR_H);
    for (let row = 0; row < BAR_H; row += 1) {
      const fromTop = flipped ? row : BAR_H - 1 - row;
      const white = fromTop < whiteCells;
      rows.push(
        <text key={row} fg={white ? theme.cream : theme.walnut}>
          {" ██ "}
        </text>,
      );
    }
  }

  const label = analysis ? formatEval(analysis) : "…";

  return (
    <box flexDirection="column" width={5}>
      {rows}
      <text fg={theme.gold}>{label.padStart(4).slice(0, 5)}</text>
    </box>
  );
}
