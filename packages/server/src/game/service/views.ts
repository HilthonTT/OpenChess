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
  title: string | null;
};

export type TimeControlView = {
  initialSeconds: number;
  incrementSeconds: number;
};

export type ClockView = {
  whiteMs: number;
  blackMs: number;
  turnStartedAt: string;
  running: Color;
};

export type GameView = {
  id: string;
  mode: GameRow["mode"];
  variant: GameVariant;
  startFen: string | null;
  difficulty: Difficulty | null;
  personality: PersonalityId | null;
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
  timeControl: TimeControlView | null;
  clock: ClockView | null;
  drawOfferFrom: Color | null;
  takebackOfferFrom: Color | null;
  takebacks: number;
  startedAt: string;
  endedAt: string | null;
  rewards: RewardView | null;
};

const PGN_RESULT: Record<GameResult, PgnResult> = {
  WHITE_WIN: "1-0",
  BLACK_WIN: "0-1",
  DRAW: "1/2-1/2",
  ABORTED: "*",
};

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

export function timeControlView(row: GameRow): TimeControlView | null {
  if (row.initialSeconds === null || row.incrementSeconds === null) {
    return null;
  }
  return {
    initialSeconds: row.initialSeconds,
    incrementSeconds: row.incrementSeconds,
  };
}

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

export function replay(row: GameRow): Game {
  try {
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
