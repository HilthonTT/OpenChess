import {
  Prisma,
  type Difficulty,
  type Game as GameRow,
  type GameResult,
  type User,
} from "@openchess/database";
import { db } from "@openchess/database/client";
import {
  capturedPieces,
  createGame,
  findBestMove,
  findLegalMove,
  fromAlgebraic,
  fromRecord,
  gameMoves,
  isGameOver,
  materialBalance,
  needsPromotion,
  play,
  toAlgebraic,
  toFen,
  toPgn,
  toSan,
  toUci,
  type Color,
  type Game,
  type HistoryEntry,
  type Move,
  type PgnResult,
  type PromotionPiece,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { throwProblem } from "../lib/problem-details";
import { satisfiedCodes } from "./achievements";
import {
  levelFor,
  outcomeFor,
  resultFor,
  resultForResignation,
  rewardFor,
  statsAfter,
  toEngineDifficulty,
} from "./rules";

/**
 * The game service: the only thing in the server that is allowed to decide what
 * a position is, or what a finished game pays.
 *
 * The board is never trusted from the client. Every request rebuilds the game by
 * replaying its stored UCI moves — which is also the only way the repetition map
 * and the fifty-move clock come back correct, since a FEN cannot carry position
 * history.
 */

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

export type GameView = {
  id: string;
  mode: GameRow["mode"];
  difficulty: Difficulty | null;
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

/** Postgres could not serialize a concurrent transaction — the caller should retry. */
const SERIALIZATION_FAILURE = "P2034";

/** Which side `userId` is playing, or null when they are not in this game. */
function colorOf(row: GameRow, userId: string): Color | null {
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

function fromHistory(entry: HistoryEntry): MoveView {
  return {
    from: toAlgebraic(entry.move.from),
    to: toAlgebraic(entry.move.to),
    promotion: entry.move.promotion,
    san: entry.san,
    uci: toUci(entry.move),
  };
}

function view(
  row: GameRow,
  game: Game,
  color: Color,
  rewards: RewardView | null,
): GameView {
  const live = !isGameOver(game.status) && row.endedAt === null;
  const captured = capturedPieces(game);

  return {
    id: row.id,
    mode: row.mode,
    difficulty: row.difficulty,
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
function replay(row: GameRow): Game {
  try {
    return fromRecord({ moves: row.moves });
  } catch (error) {
    throw new Error(
      `Game ${row.id} has an unreplayable move list: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function pgnFor(
  game: Game,
  row: GameRow,
  result: GameResult,
  playerName: string,
  color: Color,
): string {
  const bot = `OpenChess Bot (${(row.difficulty ?? "MEDIUM").toLowerCase()})`;
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

/**
 * Finish a game and pay it out, in one transaction.
 *
 * The first write is a compare-and-set on `rewardsGranted`: if it updates no
 * rows, someone else already settled this game — a retried request, a resign
 * racing a checkmate — and we return null rather than paying twice. Everything
 * after it is safe precisely because that write claimed the game.
 */
async function settle(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    user: User;
    color: Color;
    result: GameResult;
  },
): Promise<RewardView | null> {
  const { row, game, user, color, result } = input;

  const difficulty = row.difficulty ?? "MEDIUM";
  const plies = game.history.length;
  const finalFen = toFen(game.position);

  const claimed = await tx.game.updateMany({
    where: { id: row.id, rewardsGranted: false },
    data: {
      rewardsGranted: true,
      result,
      pgn: pgnFor(game, row, result, user.username, color),
      finalFen,
      currentFen: finalFen,
      moves: gameMoves(game),
      endedAt: new Date(),
    },
  });

  // Lost the race. The winner has already paid this game out.
  if (claimed.count === 0) {
    return null;
  }

  const stats = await tx.userStats.findUniqueOrThrow({
    where: { userId: user.id },
  });

  const outcome = outcomeFor(result, color);

  // An abort is settled but never paid: no stats, no XP, no coins.
  if (outcome === null) {
    return {
      xp: 0,
      coins: 0,
      levelBefore: user.level,
      levelAfter: user.level,
      ratingBefore: stats.rating,
      ratingAfter: stats.rating,
      unlocked: [],
    };
  }

  const after = statsAfter(stats, outcome, difficulty);
  await tx.userStats.update({ where: { userId: user.id }, data: after });

  const base = rewardFor({ result, color, difficulty, plies });

  // Unlock only achievements that both have a rule and exist in the table, and
  // that this player does not already hold.
  const codes = satisfiedCodes({
    stats: after,
    outcome,
    difficulty,
    plies,
    byCheckmate: game.status === "checkmate",
  });

  const candidates = await tx.achievement.findMany({
    where: { code: { in: codes } },
  });

  const held = await tx.userAchievement.findMany({
    where: {
      userId: user.id,
      achievementId: { in: candidates.map((achievement) => achievement.id) },
    },
    select: { achievementId: true },
  });

  const heldIds = new Set(held.map((row) => row.achievementId));
  const unlocked = candidates.filter(
    (achievement) => !heldIds.has(achievement.id),
  );

  if (unlocked.length > 0) {
    await tx.userAchievement.createMany({
      data: unlocked.map((achievement) => ({
        userId: user.id,
        achievementId: achievement.id,
      })),
      skipDuplicates: true,
    });
  }

  const bonusXp = unlocked.reduce((sum, a) => sum + a.xpReward, 0);
  const bonusCoins = unlocked.reduce((sum, a) => sum + a.coinReward, 0);

  const xp = base.xp + bonusXp;
  const experience = user.experience + xp;
  const levelAfter = levelFor(experience);

  // One ledger row per reason: `@@unique([userId, gameId, reason])` allows
  // exactly one GAME_REWARD and one ACHIEVEMENT per game, so the achievement
  // bonuses are banked as a single row rather than one per unlock.
  let balance = user.coins;
  const ledger: Prisma.CoinTransactionCreateManyInput[] = [];

  if (base.coins > 0) {
    balance += base.coins;
    ledger.push({
      userId: user.id,
      amount: base.coins,
      reason: "GAME_REWARD",
      gameId: row.id,
      balanceAfter: balance,
    });
  }

  if (bonusCoins > 0) {
    balance += bonusCoins;
    ledger.push({
      userId: user.id,
      amount: bonusCoins,
      reason: "ACHIEVEMENT",
      gameId: row.id,
      balanceAfter: balance,
    });
  }

  if (ledger.length > 0) {
    await tx.coinTransaction.createMany({ data: ledger });
  }

  await tx.user.update({
    where: { id: user.id },
    data: { experience, level: levelAfter, coins: balance },
  });

  return {
    xp,
    coins: base.coins + bonusCoins,
    levelBefore: user.level,
    levelAfter,
    ratingBefore: stats.rating,
    ratingAfter: after.rating,
    unlocked: unlocked.map((achievement) => ({
      code: achievement.code,
      name: achievement.name,
      description: achievement.description,
      xpReward: achievement.xpReward,
      coinReward: achievement.coinReward,
    })),
  };
}

/** Run `work` serializably, mapping Postgres' serialization failure onto a 409. */
async function serializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await db.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === SERIALIZATION_FAILURE
    ) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Another request touched this game at the same time. Refetch it and try again.",
      );
    }
    throw error;
  }
}

/** Load a game the caller is actually a player in. */
async function loadFor(
  tx: Prisma.TransactionClient,
  gameId: string,
  userId: string,
): Promise<{ row: GameRow; game: Game; color: Color }> {
  const row = await tx.game.findUnique({ where: { id: gameId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  const color = colorOf(row, userId);
  if (!color) {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      "You are not a player in this game",
    );
  }

  return { row, game: replay(row), color };
}

export async function createAiGame(input: {
  user: User;
  difficulty: Difficulty;
  color: "white" | "black" | "random";
}): Promise<GameView> {
  const color: Color =
    input.color === "random"
      ? Math.random() < 0.5
        ? "w"
        : "b"
      : input.color === "white"
        ? "w"
        : "b";

  let game = createGame();

  // The bot has white, so it opens. Playing it here rather than on the first
  // move request means the client is never handed a board it is not to move on.
  if (color === "b") {
    const opening = findBestMove(
      game.position,
      toEngineDifficulty(input.difficulty),
    );
    if (opening) {
      game = play(game, opening);
    }
  }

  const row = await db.game.create({
    data: {
      mode: "AI",
      difficulty: input.difficulty,
      whitePlayerId: color === "w" ? input.user.id : null,
      blackPlayerId: color === "b" ? input.user.id : null,
      moves: gameMoves(game),
      currentFen: toFen(game.position),
    },
  });

  return view(row, game, color, null);
}

export async function getGame(gameId: string, user: User): Promise<GameView> {
  const { row, game, color } = await loadFor(db, gameId, user.id);
  return view(row, game, color, null);
}

export type MoveResult = {
  yourMove: MoveView;
  /** Null when your move ended the game. */
  aiMove: MoveView | null;
  state: GameView;
};

export async function playMove(input: {
  gameId: string;
  user: User;
  from: string;
  to: string;
  promotion?: PromotionPiece;
  ply: number;
}): Promise<MoveResult> {
  return serializable(async (tx) => {
    const {
      row,
      game: loaded,
      color,
    } = await loadFor(tx, input.gameId, input.user.id);

    if (row.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
    }

    if (row.mode !== "AI" || row.difficulty === null) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Only AI games can be played through this endpoint",
      );
    }

    // The retry guard. Without it, a client that retries a request whose response
    // it never saw would play its move a second time.
    if (input.ply !== row.moves.length) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `The board has moved on: you played from ply ${input.ply}, the game is at ply ${row.moves.length}. Refetch the game.`,
      );
    }

    if (loaded.position.turn !== color) {
      throwProblem(HttpStatusCodes.CONFLICT, "It is not your turn");
    }

    const from = fromAlgebraic(input.from);
    const to = fromAlgebraic(input.to);

    if (from === null || to === null) {
      throwProblem(
        HttpStatusCodes.UNPROCESSABLE_ENTITY,
        `Not a square: ${input.from}${input.to}`,
      );
    }

    // Catch this before `findLegalMove`, which would otherwise quietly pick the
    // first matching promotion — always a queen — on the player's behalf.
    if (needsPromotion(loaded, from, to) && input.promotion === undefined) {
      throwProblem(
        HttpStatusCodes.UNPROCESSABLE_ENTITY,
        "That move promotes a pawn. Say which piece to promote to.",
      );
    }

    const move = findLegalMove(loaded, from, to, input.promotion);
    if (!move) {
      throwProblem(
        HttpStatusCodes.UNPROCESSABLE_ENTITY,
        `Illegal move: ${input.from}${input.to}`,
      );
    }

    let game = play(loaded, move);
    const yourMove = fromHistory(game.history[game.history.length - 1]!);

    let aiMove: MoveView | null = null;

    if (!isGameOver(game.status)) {
      const reply = findBestMove(
        game.position,
        toEngineDifficulty(row.difficulty),
      );

      if (reply) {
        game = play(game, reply);
        aiMove = fromHistory(game.history[game.history.length - 1]!);
      }
    }

    if (isGameOver(game.status)) {
      const result = resultFor(game.status, game.position.turn);

      // `isGameOver` is true and the status is terminal, so a result exists.
      const rewards = await settle(tx, {
        row,
        game,
        user: input.user,
        color,
        result: result!,
      });

      const settled = await tx.game.findUniqueOrThrow({
        where: { id: row.id },
      });
      return { yourMove, aiMove, state: view(settled, game, color, rewards) };
    }

    const updated = await tx.game.update({
      where: { id: row.id },
      data: { moves: gameMoves(game), currentFen: toFen(game.position) },
    });

    return { yourMove, aiMove, state: view(updated, game, color, null) };
  });
}

export async function resignGame(
  gameId: string,
  user: User,
): Promise<GameView> {
  return serializable(async (tx) => {
    const { row, game, color } = await loadFor(tx, gameId, user.id);

    // Resigning a game that is already over is a no-op, not an error: a client
    // retrying a resign it never saw the answer to deserves the same reply.
    if (row.endedAt !== null) {
      return view(row, game, color, null);
    }

    const rewards = await settle(tx, {
      row,
      game,
      user,
      color,
      result: resultForResignation(color),
    });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards);
  });
}

export async function abortGame(gameId: string, user: User): Promise<GameView> {
  return serializable(async (tx) => {
    const { row, game, color } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null);
    }

    // The escape hatch for a misclicked game. Keeping it distinct from a resign
    // is the whole point: an abort must never become a loss on the record.
    if (row.moves.length > 0) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "This game is under way. Resign it instead of aborting it.",
      );
    }

    const rewards = await settle(tx, {
      row,
      game,
      user,
      color,
      result: "ABORTED",
    });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards);
  });
}

export type GameSummary = {
  id: string;
  mode: GameRow["mode"];
  difficulty: Difficulty | null;
  yourColor: Color;
  result: GameResult | null;
  ply: number;
  startedAt: string;
  endedAt: string | null;
};

function summarize(row: GameRow, userId: string): GameSummary {
  return {
    id: row.id,
    mode: row.mode,
    difficulty: row.difficulty,
    // Every row we list here was queried by this user's own id on one side or
    // the other, so the color is never actually null.
    yourColor: colorOf(row, userId) ?? "w",
    result: row.result,
    ply: row.moves.length,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

/** The caller's finished games, newest first, cursor-paginated on `endedAt`. */
export async function listGames(input: {
  user: User;
  limit: number;
  cursor?: Date;
  result?: GameResult;
}): Promise<{ games: GameSummary[]; nextCursor: string | null }> {
  const rows = await db.game.findMany({
    where: {
      OR: [{ whitePlayerId: input.user.id }, { blackPlayerId: input.user.id }],
      endedAt: input.cursor ? { not: null, lt: input.cursor } : { not: null },
      ...(input.result ? { result: input.result } : {}),
    },
    orderBy: { endedAt: "desc" },
    // One extra row tells us whether another page exists without a second query.
    take: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const next =
    rows.length > input.limit ? page[page.length - 1]?.endedAt : null;

  return {
    games: page.map((row) => summarize(row, input.user.id)),
    nextCursor: next ? next.toISOString() : null,
  };
}

/** Games still in progress. Lets a client offer "resume" instead of stranding rows. */
export async function listActiveGames(user: User): Promise<GameSummary[]> {
  const rows = await db.game.findMany({
    where: {
      OR: [{ whitePlayerId: user.id }, { blackPlayerId: user.id }],
      endedAt: null,
    },
    orderBy: { startedAt: "desc" },
  });

  return rows.map((row) => summarize(row, user.id));
}
