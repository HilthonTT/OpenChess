import type {
  Difficulty,
  Game as GameRow,
  GameResult,
  GameVariant,
} from "@openchess/database";
import {
  capturedPieces,
  fromRecord,
  isGameOver,
  materialBalance,
  toAlgebraic,
  toFen,
  toPgn,
  toSan,
  toUci,
  type Color,
  type Game,
  type HistoryEntry,
  type Move,
  type PersonalityId,
  type PgnResult,
  type PromotionPiece,
} from "@openchess/shared";
import { botFor, toOfferColor, type ClockState } from "../rules";

export type MoveView = {
  from: string;
  to: string;
  promotion: PromotionPiece | null;
  san: string;
  uci: string;
};

export type UnlockView = {
  code: string;
  name: string;
  description: string;
  xpReward: number;
  coinReward: number;
};

export type RewardView = {
  xp: number;
  coins: number;
  levelBefore: number;
  levelAfter: number;
  ratingBefore: number;
  ratingAfter: number;
  unlocked: UnlockView[];
};

export type OpponentView = {
  username: string;
  /** The label of their equipped title, if any. */
  title: string | null;
};

export type TimeControlView = {
  initialSeconds: number;
  incrementSeconds: number;
};

export type ClockView = {
  /** Milliseconds left for each side as of the last committed move. */
  whiteMs: number;
  blackMs: number;
  /**
   * When the running side's clock started — the last move's commit, or the
   * game's start. A reader ticks `running`'s time down from here.
   */
  turnStartedAt: string;
  /** Whose clock is running. Only meaningful while the game is live. */
  running: Color;
};

export type GameView = {
  id: string;
  mode: GameRow["mode"];
  variant: GameVariant;
  /**
   * The array the game began from, or null when it is the ordinary one. A
   * client rebuilds the board by replaying `history`, and replaying a shuffled
   * game's moves onto the standard array puts the wrong pieces everywhere —
   * so this is not decoration, it is what makes the history readable.
   */
  startFen: string | null;
  difficulty: Difficulty | null;
  /** Which bot is playing, in an AI game; null in a PvP game. */
  personality: PersonalityId | null;
  /** The other human in a PvP game; null in an AI game. */
  opponent: OpponentView | null;
  yourColor: Color;
  fen: string;
  turn: Color;
  status: Game["status"];
  ply: number;
  legalMoves: MoveView[];
  history: string[];
  captured: { byWhite: string[]; byBlack: string[] };
  materialBalance: number;
  result: GameResult | null;
  /** The game's clock, or null when it is untimed. */
  timeControl: TimeControlView | null;
  /** Live clock readings, or null when the game is untimed. */
  clock: ClockView | null;
  /**
   * The side with a draw offer standing, or null when none is. Compare it with
   * `yourColor`: your own offer is waiting on them, theirs is yours to answer.
   * Always null on a settled game — ending one clears any offer with it.
   */
  drawOfferFrom: Color | null;
  /**
   * The side with a takeback offer standing, or null when none is. Read the
   * same way as `drawOfferFrom`: yours is waiting on them, theirs is yours to
   * answer. Always null on an AI game, where a takeback is taken rather than
   * asked for, and null again the moment anyone moves.
   */
  takebackOfferFrom: Color | null;
  /**
   * How many moves have been taken back. Non-zero only on an AI game, and the
   * reason its payout will be nothing — a screen shows it so the forfeit is
   * visible before the game ends rather than as a surprise at the end of it.
   */
  takebacks: number;
  startedAt: string;
  endedAt: string | null;
  /** Populated only on the response that ends the game. */
  rewards: RewardView | null;
};

const PGN_RESULT: Record<GameResult, PgnResult> = {
  WHITE_WIN: "1-0",
  BLACK_WIN: "0-1",
  DRAW: "1/2-1/2",
  ABORTED: "*",
};

/** Which side `userId` is playing, or null when they are not in this game. */
export function colorOf(row: GameRow, userId: string): Color | null {
  if (row.whitePlayerId === userId) {
    return "w";
  }
  if (row.blackPlayerId === userId) {
    return "b";
  }
  return null;
}

function toMoveView(
  position: Game["position"],
  move: Move,
  legal: Move[],
): MoveView {
  return {
    from: toAlgebraic(move.from),
    to: toAlgebraic(move.to),
    promotion: move.promotion,
    san: toSan(position, move, legal),
    uci: toUci(move),
  };
}

export function fromHistory(entry: HistoryEntry): MoveView {
  return {
    from: toAlgebraic(entry.move.from),
    to: toAlgebraic(entry.move.to),
    promotion: entry.move.promotion,
    san: entry.san,
    uci: toUci(entry.move),
  };
}

/** The game's clock preset, or null when it carries no time control. */
export function timeControlView(row: GameRow): TimeControlView | null {
  if (row.initialSeconds === null || row.incrementSeconds === null) {
    return null;
  }
  return {
    initialSeconds: row.initialSeconds,
    incrementSeconds: row.incrementSeconds,
  };
}

/** The live clock, or null when the game is untimed. */
export function clockView(row: GameRow, game: Game): ClockView | null {
  if (
    row.whiteTimeMs === null ||
    row.blackTimeMs === null ||
    row.turnStartedAt === null
  ) {
    return null;
  }
  return {
    whiteMs: row.whiteTimeMs,
    blackMs: row.blackTimeMs,
    turnStartedAt: row.turnStartedAt.toISOString(),
    running: game.position.turn,
  };
}

/** The stored clock as a plain pair, or null when the game is untimed. */
export function clockState(row: GameRow): ClockState | null {
  if (row.whiteTimeMs === null || row.blackTimeMs === null) {
    return null;
  }
  return { whiteTimeMs: row.whiteTimeMs, blackTimeMs: row.blackTimeMs };
}

export function view(
  row: GameRow,
  game: Game,
  color: Color,
  rewards: RewardView | null,
  opponent: OpponentView | null = null,
): GameView {
  const live = !isGameOver(game.status) && row.endedAt === null;
  const captured = capturedPieces(game);

  return {
    id: row.id,
    mode: row.mode,
    variant: row.variant,
    startFen: row.startFen,
    difficulty: row.difficulty,
    personality: row.mode === "AI" ? botFor(row).id : null,
    opponent,
    yourColor: color,
    fen: toFen(game.position),
    turn: game.position.turn,
    status: game.status,
    ply: game.history.length,
    // Only ever the mover's own options, and only while the game is live — the
    // client has no business being handed the bot's replies to choose from.
    legalMoves:
      live && game.position.turn === color
        ? game.legalMoves.map((move) =>
            toMoveView(game.position, move, game.legalMoves),
          )
        : [],
    history: game.history.map((entry) => entry.san),
    captured: { byWhite: captured.byWhite, byBlack: captured.byBlack },
    materialBalance: materialBalance(game.position),
    result: row.result,
    timeControl: timeControlView(row),
    clock: clockView(row, game),
    drawOfferFrom: toOfferColor(row.drawOfferedBy),
    takebackOfferFrom: toOfferColor(row.takebackOfferedBy),
    takebacks: row.takebacks,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    rewards,
  };
}

/**
 * Rebuild the engine game from its stored moves.
 *
 * A row whose moves do not replay is corrupt — we wrote it, so this is our bug
 * and not the caller's. It earns a 500 rather than a 4xx.
 */
export function replay(row: GameRow): Game {
  try {
    // `startFen` is null on a standard game and `fromRecord` falls back to the
    // ordinary array. On a shuffled one it is the only record of which of the
    // 960 was dealt, and replaying without it would not merely mislabel the
    // game — the moves would land on different pieces.
    return fromRecord({ fen: row.startFen ?? undefined, moves: row.moves });
  } catch (error) {
    throw new Error(
      `Game ${row.id} has an unreplayable move list: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function pgnFor(
  game: Game,
  row: GameRow,
  result: GameResult,
  playerName: string,
  color: Color,
): string {
  const bot = `OpenChess ${botFor(row).name}`;
  const date = row.startedAt.toISOString().slice(0, 10).replace(/-/g, ".");

  return toPgn(game, {
    result: PGN_RESULT[result],
    tags: {
      event: "OpenChess AI game",
      site: "OpenChess",
      date,
      round: "-",
      white: color === "w" ? playerName : bot,
      black: color === "b" ? playerName : bot,
    },
  });
}

export function pvpPgnFor(
  game: Game,
  row: GameRow,
  result: GameResult,
  white: string,
  black: string,
): string {
  const date = row.startedAt.toISOString().slice(0, 10).replace(/-/g, ".");

  return toPgn(game, {
    result: PGN_RESULT[result],
    tags: {
      event: "OpenChess online game",
      site: "OpenChess",
      date,
      round: "-",
      white,
      black,
    },
  });
}
