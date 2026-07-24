import { findKing, formatClock } from "@openchess/shared";
import type { Color, Game, Move } from "@openchess/shared";
import { Board } from "./board";
import { CapturedSummary, MoveList, PromotionPrompt } from "./game-panels";
import type { LiveClock } from "../hooks/use-clock";
import { useUITheme } from "../providers/theme";

/** One side's clock, as the screen has already resolved it for this viewer. */
export type ClockRow = {
  label: string;
  ms: number;
  /** This side's clock is the one running right now. */
  ticking: boolean;
};

export type MatchClocks = {
  /** The side drawn at the top of the board — the opponent, usually. */
  top: ClockRow;
  /** The side drawn at the bottom — the viewer, usually. */
  bottom: ClockRow;
};

/** Under this many milliseconds a running clock turns urgent. */
const LOW_TIME_MS = 10_000;

/**
 * Orient a live clock to the board: the side drawn at the bottom is white
 * unless the board is flipped. `labelFor` names each side for this viewer
 * ("You" / the opponent), and `running` — the server's word on whose clock
 * ticks — drives which row shows as active. Null when the game is untimed.
 */
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

/**
 * One side's clock. Exported because the spectator screen draws the same two
 * rows around a board that `MatchView` itself cannot render — that component is
 * built around a player's cursor, selection and promotion prompt, none of which
 * a watcher has.
 */
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

/**
 * The stack every game screen shares: board beside the move list, captures
 * underneath, and a status line that yields to the promotion picker.
 */
export function MatchView({
  game,
  cursor,
  selected,
  targets,
  flipped,
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
  /** The promotion prompt replaces the status line while it is open. */
  promotion: boolean;
  over: boolean;
  statusText: string;
  /** Both sides' clocks, already oriented to the board; omitted when untimed. */
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
