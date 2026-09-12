import { findKing, formatClock } from "@openchess/shared";
import type { Color, Game, Move, Premove } from "@openchess/shared";
import { Board } from "./board";
import { CapturedSummary, MoveList, PromotionPrompt } from "./game-panels";
import type { LiveClock } from "../hooks/use-clock";
import { useUITheme } from "../providers/theme";

export type ClockRow = {
  label: string;
  ms: number;
  ticking: boolean;
};

export type MatchClocks = {
  top: ClockRow;
  bottom: ClockRow;
};

const LOW_TIME_MS = 10_000;

export function orientClocks(input: {
  live: LiveClock | null;
  running: Color;
  over: boolean;
  flipped: boolean;
  labelFor: (color: Color) => string;
}): MatchClocks | null {
  const { live } = input;
  if (!live) {
    return null;
  }

  const bottomColor: Color = input.flipped ? "b" : "w";
  const topColor: Color = bottomColor === "w" ? "b" : "w";

  const msOf = (color: Color) => (color === "w" ? live.whiteMs : live.blackMs);
  const tickingOn = (color: Color) => !input.over && input.running === color;

  const rowFor = (color: Color): ClockRow => ({
    label: input.labelFor(color),
    ms: msOf(color),
    ticking: tickingOn(color),
  });

  return { top: rowFor(topColor), bottom: rowFor(bottomColor) };
}

export function ClockLine({ row }: { row: ClockRow }) {
  const theme = useUITheme();

  const low = row.ticking && row.ms < LOW_TIME_MS;
  const time = row.ticking ? (low ? theme.gold : theme.cream) : theme.dim;

  return (
    <box flexDirection="row" width="100%" justifyContent="space-between">
      <text>
        <span fg={row.ticking ? theme.gold : theme.faint}>
          {row.ticking ? "● " : "  "}
        </span>
        <span fg={theme.dim}>{row.label}</span>
      </text>
      <text fg={time}>{formatClock(row.ms)}</text>
    </box>
  );
}

export function MatchView({
  game,
  cursor,
  selected,
  targets,
  flipped,
  premove = null,
  promotion,
  over,
  statusText,
  clocks,
}: {
  game: Game;
  cursor: number;
  selected: number | null;
  targets: Move[];
  flipped: boolean;
  premove?: Premove | null;
  promotion: boolean;
  over: boolean;
  statusText: string;
  clocks?: MatchClocks | null;
}) {
  const theme = useUITheme();
  const { position, status } = game;

  const lastMove = game.history[game.history.length - 1]?.move ?? null;
  const checkSquare =
    status === "check" || status === "checkmate"
      ? findKing(position.board, position.turn)
      : null;

  return (
    <>
      {clocks ? <ClockLine row={clocks.top} /> : null}

      <box flexDirection="row" gap={2}>
        <Board
          board={position.board}
          cursor={cursor}
          selected={selected}
          targets={targets}
          lastMove={lastMove}
          checkSquare={checkSquare}
          flipped={flipped}
          premove={premove}
        />
        <MoveList game={game} />
      </box>

      <CapturedSummary game={game} />

      {clocks ? <ClockLine row={clocks.bottom} /> : null}

      {promotion ? (
        <PromotionPrompt />
      ) : (
        <text fg={over ? theme.gold : theme.dim}>{statusText}</text>
      )}
    </>
  );
}
