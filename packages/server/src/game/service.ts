import {
  Prisma,
  type Difficulty,
  type Game as GameRow,
  type GameResult,
  type User,
  type UserStats,
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
  TIME_CONTROLS,
  type Color,
  type Game,
  type HistoryEntry,
  type Move,
  type PgnResult,
  type PromotionPiece,
  type TimeControlKey,
} from "@openchess/shared";
import * as HttpStatusCodes from "stoker/http-status-codes";

import { invalidateCache } from "../lib/cache";
import { throwProblem } from "../lib/problem-details";
import { unlockAchievements } from "../player/unlocks";
import { satisfiedCodes } from "./achievements";
import { publishGameChanged } from "./events";
import * as matchmaking from "./matchmaking";
import {
  clockAfterMove,
  hasFlagged,
  levelFor,
  outcomeFor,
  ratingAfter,
  ratingAgainst,
  resultFor,
  resultForResignation,
  resultForTimeout,
  rewardFor,
  rewardForPvp,
  MIN_REWARDED_PLIES,
  statsAfter,
  timeOf,
  toEngineDifficulty,
  type ClockState,
  type Outcome,
  type Reward,
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
  difficulty: Difficulty | null;
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

/** The game's clock preset, or null when it carries no time control. */
function timeControlView(row: GameRow): TimeControlView | null {
  if (row.initialSeconds === null || row.incrementSeconds === null) {
    return null;
  }
  return {
    initialSeconds: row.initialSeconds,
    incrementSeconds: row.incrementSeconds,
  };
}

/** The live clock, or null when the game is untimed. */
function clockView(row: GameRow, game: Game): ClockView | null {
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
function clockState(row: GameRow): ClockState | null {
  if (row.whiteTimeMs === null || row.blackTimeMs === null) {
    return null;
  }
  return { whiteTimeMs: row.whiteTimeMs, blackTimeMs: row.blackTimeMs };
}

function view(
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
    difficulty: row.difficulty,
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

function pvpPgnFor(
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

/** A settled game that paid this player nothing: an abort, from either side. */
function nothingEarned(user: User, rating: number): RewardView {
  return {
    xp: 0,
    coins: 0,
    levelBefore: user.level,
    levelAfter: user.level,
    ratingBefore: rating,
    ratingAfter: rating,
    unlocked: [],
  };
}

/**
 * The compare-and-set that ends a game: if it updates no rows, someone else
 * already settled this one — a retried request, a resign racing a checkmate —
 * and the caller must not pay anyone. Everything downstream of a `true` is safe
 * precisely because this write claimed the game.
 */
async function claimGame(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    result: GameResult;
    pgn: string;
    /** Final clock to freeze, e.g. a flagged side at zero. Omitted leaves it. */
    clock?: ClockState;
  },
): Promise<boolean> {
  const finalFen = toFen(input.game.position);

  const claimed = await tx.game.updateMany({
    where: { id: input.row.id, rewardsGranted: false },
    data: {
      rewardsGranted: true,
      result: input.result,
      pgn: input.pgn,
      finalFen,
      currentFen: finalFen,
      moves: gameMoves(input.game),
      ...(input.clock
        ? {
            whiteTimeMs: input.clock.whiteTimeMs,
            blackTimeMs: input.clock.blackTimeMs,
          }
        : {}),
      endedAt: new Date(),
    },
  });

  return claimed.count > 0;
}

/**
 * Pay one player for one settled game: stats, achievements, XP, coins, ledger.
 * Runs only after `claimGame` succeeded, so exactly once per game per player.
 */
async function payoutPlayer(
  tx: Prisma.TransactionClient,
  input: {
    gameId: string;
    user: User;
    /** The player's stats row as it stood *before* this game. */
    stats: UserStats;
    outcome: Outcome;
    newRating: number;
    base: Reward;
    difficulty: Difficulty | null;
    plies: number;
    byCheckmate: boolean;
  },
): Promise<RewardView> {
  const { user, stats, outcome, base } = input;

  // The reward floor zeroes the *base* payout for a game too short to be a
  // game, but wins, rating and achievements are minted here — so a sub-floor
  // decisive result still moved the leaderboard and unlocked win-count trophies
  // for free. That is the win-trading farm: two accounts queue, the loser
  // resigns at move one, and the winner banks a win, a rating bump and
  // achievement coins at no cost. Settle such a game as a no-contest — like an
  // abort, nobody's record moves. A genuine fast win is a checkmate
  // (fool's/scholar's mate) and is exempt, matching how the ply floor already
  // reasons about "not really a game".
  if (
    (outcome === "win" || outcome === "loss") &&
    input.plies < MIN_REWARDED_PLIES &&
    !input.byCheckmate
  ) {
    return nothingEarned(user, stats.rating);
  }

  const after = statsAfter(stats, outcome, input.newRating);
  await tx.userStats.update({ where: { userId: user.id }, data: after });

  // Unlock only achievements that both have a rule and exist in the table, and
  // that this player does not already hold.
  const codes = satisfiedCodes({
    stats: after,
    outcome,
    difficulty: input.difficulty,
    plies: input.plies,
    byCheckmate: input.byCheckmate,
  });

  const unlocked = await unlockAchievements(tx, user.id, codes);

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
      gameId: input.gameId,
      balanceAfter: balance,
    });
  }

  if (bonusCoins > 0) {
    balance += bonusCoins;
    ledger.push({
      userId: user.id,
      amount: bonusCoins,
      reason: "ACHIEVEMENT",
      gameId: input.gameId,
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
    unlocked,
  };
}

/** Finish an AI game and pay its one human, in one transaction. */
async function settle(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    user: User;
    color: Color;
    result: GameResult;
    /** Final clock to freeze; omitted leaves the stored one. */
    clock?: ClockState;
  },
): Promise<RewardView | null> {
  const { row, game, user, color, result } = input;

  const difficulty = row.difficulty ?? "MEDIUM";
  const plies = game.history.length;

  const claimed = await claimGame(tx, {
    row,
    game,
    result,
    pgn: pgnFor(game, row, result, user.username, color),
    clock: input.clock,
  });

  // Lost the race. The winner has already paid this game out.
  if (!claimed) {
    return null;
  }

  // Re-read the player inside the transaction, the way the purchase path does:
  // the `user` on the request was loaded by middleware before it, and a
  // concurrent purchase or payout may have moved coins or XP since. Writing
  // absolute values computed from that stale read would silently undo them.
  const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });

  const stats = await tx.userStats.findUniqueOrThrow({
    where: { userId: user.id },
  });

  const outcome = outcomeFor(result, color);

  // An abort is settled but never paid: no stats, no XP, no coins.
  if (outcome === null) {
    return nothingEarned(fresh, stats.rating);
  }

  return payoutPlayer(tx, {
    gameId: row.id,
    user: fresh,
    stats,
    outcome,
    newRating: ratingAfter(stats.rating, outcome, difficulty),
    base: rewardFor({ result, color, difficulty, plies }),
    difficulty,
    plies,
    byCheckmate: game.status === "checkmate",
  });
}

/**
 * Finish a PvP game and pay both sides, in one transaction.
 *
 * Both ratings are read before either is written, so each side's Elo moves
 * against the rating their opponent actually brought into the game. The return
 * value is the *mover's* reward view — the opponent's payout happens here too,
 * but they learn the game is over from their next poll, which reports the
 * result without a payout breakdown.
 */
async function settlePvp(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    mover: User;
    result: GameResult;
    /** Final clock to freeze; omitted leaves the stored one. */
    clock?: ClockState;
  },
): Promise<RewardView | null> {
  const { row, game, mover, result } = input;

  const plies = game.history.length;
  const byCheckmate = game.status === "checkmate";

  // A PVP row is created with both players, but `onDelete: SetNull` means a
  // deleted account leaves an empty side. A missing side just goes unpaid.
  const sides: Array<{ color: Color; userId: string | null }> = [
    { color: "w", userId: row.whitePlayerId },
    { color: "b", userId: row.blackPlayerId },
  ];

  const players: Array<{ color: Color; user: User; stats: UserStats }> = [];

  for (const side of sides) {
    if (side.userId === null) {
      continue;
    }

    // Both players re-read inside the transaction — including the mover, whose
    // request-scoped row predates it. See the same re-read in `settle`.
    const user = await tx.user.findUnique({ where: { id: side.userId } });

    if (!user) {
      continue;
    }

    const stats = await tx.userStats.findUniqueOrThrow({
      where: { userId: user.id },
    });

    players.push({ color: side.color, user, stats });
  }

  const white = players.find((player) => player.color === "w");
  const black = players.find((player) => player.color === "b");

  const claimed = await claimGame(tx, {
    row,
    game,
    result,
    pgn: pvpPgnFor(
      game,
      row,
      result,
      white?.user.username ?? "Anonymous",
      black?.user.username ?? "Anonymous",
    ),
    clock: input.clock,
  });

  if (!claimed) {
    return null;
  }

  let moverView: RewardView | null = null;

  for (const player of players) {
    const outcome = outcomeFor(result, player.color);
    const opponent = player.color === "w" ? black : white;

    const rewards =
      outcome === null
        ? nothingEarned(player.user, player.stats.rating)
        : await payoutPlayer(tx, {
            gameId: row.id,
            user: player.user,
            stats: player.stats,
            outcome,
            // Against the opponent's pre-game rating — or the default when the
            // opponent deleted their account mid-game.
            newRating: ratingAgainst(
              player.stats.rating,
              opponent?.stats.rating ?? 1200,
              outcome,
            ),
            base: rewardForPvp({ result, color: player.color, plies }),
            difficulty: null,
            plies,
            byCheckmate,
          });

    if (player.user.id === mover.id) {
      moverView = rewards;
    }
  }

  return moverView;
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

/** The other human's public face, for the PvP header. */
async function opponentFor(
  tx: Prisma.TransactionClient,
  row: GameRow,
  userId: string,
): Promise<OpponentView | null> {
  const opponentId =
    row.whitePlayerId === userId ? row.blackPlayerId : row.whitePlayerId;

  if (!opponentId) {
    return null;
  }

  const opponent = await tx.user.findUnique({
    where: { id: opponentId },
    select: { username: true, equippedTitle: { select: { label: true } } },
  });

  return opponent
    ? {
        username: opponent.username,
        title: opponent.equippedTitle?.label ?? null,
      }
    : null;
}

/** Load a game the caller is actually a player in. */
async function loadFor(
  tx: Prisma.TransactionClient,
  gameId: string,
  userId: string,
): Promise<{
  row: GameRow;
  game: Game;
  color: Color;
  opponent: OpponentView | null;
}> {
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

  const opponent =
    row.mode === "PVP" ? await opponentFor(tx, row, userId) : null;

  return { row, game: replay(row), color, opponent };
}

/**
 * Unfinished games are rows the resume flow will never reach past the newest
 * one; without a ceiling a client loop could grow the table without bound.
 */
const MAX_ACTIVE_GAMES = 20;

/**
 * The clock columns a new game is born with. An untimed game gets none of them,
 * leaving every clock field null — which is exactly what `view` reads as
 * "untimed", so the current behaviour is preserved by writing nothing.
 */
export function initialClockData(
  timeControl: TimeControlKey | null | undefined,
): {
  initialSeconds?: number;
  incrementSeconds?: number;
  whiteTimeMs?: number;
  blackTimeMs?: number;
  turnStartedAt?: Date;
} {
  if (!timeControl) {
    return {};
  }

  const preset = TIME_CONTROLS[timeControl];
  const ms = preset.initialSeconds * 1000;

  return {
    initialSeconds: preset.initialSeconds,
    incrementSeconds: preset.incrementSeconds,
    whiteTimeMs: ms,
    blackTimeMs: ms,
    turnStartedAt: new Date(),
  };
}

export async function createAiGame(input: {
  user: User;
  difficulty: Difficulty;
  color: "white" | "black" | "random";
  timeControl?: TimeControlKey | null;
}): Promise<GameView> {
  // Checked outside a transaction, so two racing creates can land at cap + 1.
  // The ceiling is a backstop against runaway loops, not an invariant — off by
  // one is fine, and the next create is refused either way.
  const active = await db.game.count({
    where: {
      OR: [{ whitePlayerId: input.user.id }, { blackPlayerId: input.user.id }],
      endedAt: null,
    },
  });

  if (active >= MAX_ACTIVE_GAMES) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      `You have ${active} unfinished games. Finish, resign or abort one before starting another.`,
    );
  }

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
      // The clock starts after any opening the bot just played, so the human's
      // first think is measured from now rather than from before the bot moved.
      ...initialClockData(input.timeControl),
    },
  });

  return view(row, game, color, null);
}

export type QueueResult =
  | { status: "waiting"; game: null }
  | { status: "matched"; game: GameView };

/**
 * One poll of the matchmaking queue. The client calls this every couple of
 * seconds while searching; each call doubles as the heartbeat that keeps the
 * player eligible for pairing.
 *
 * An unfinished PvP game *is* the match — whether our last poll created it,
 * our partner's did, or it has been waiting since yesterday. One live PvP game
 * per player, resumed rather than multiplied.
 */
export async function joinPvpQueue(
  user: User,
  timeControl: TimeControlKey | null = null,
): Promise<QueueResult> {
  const existing = await db.game.findFirst({
    where: {
      mode: "PVP",
      endedAt: null,
      OR: [{ whitePlayerId: user.id }, { blackPlayerId: user.id }],
    },
    orderBy: { startedAt: "desc" },
  });

  if (existing) {
    await matchmaking.leave(user.id);

    // `colorOf` cannot miss: the query matched this user on one side or the
    // other. The fallback is for the type, not for a case that happens.
    const color = colorOf(existing, user.id) ?? "w";
    const opponent = await opponentFor(db, existing, user.id);

    return {
      status: "matched",
      game: view(existing, replay(existing), color, null, opponent),
    };
  }

  // Our partner's poll is creating the game row right now; our next poll will
  // find it above. Re-enqueueing here would risk a second pairing.
  if (await matchmaking.isPairing(user.id)) {
    return { status: "waiting", game: null };
  }

  const partnerId = await matchmaking.takePartner(user.id, timeControl);

  if (partnerId === null) {
    await matchmaking.heartbeat(user.id, timeControl);
    return { status: "waiting", game: null };
  }

  try {
    const partner = await db.user.findUnique({
      where: { id: partnerId },
      include: { equippedTitle: { select: { label: true } } },
    });

    // Deleted between queueing and pairing. Back to waiting.
    if (!partner) {
      await matchmaking.heartbeat(user.id, timeControl);
      return { status: "waiting", game: null };
    }

    const userIsWhite = Math.random() < 0.5;

    // The no-live-game check at the top of this poll is stale by now — a
    // delayed duplicate poll may have paired one of us meanwhile. Re-check and
    // create atomically, serializably, so two racing creates collide instead
    // of both landing; the loser reports "waiting" and its next poll resumes
    // whatever game exists.
    let row: GameRow | null = null;
    try {
      row = await db.$transaction(
        async (tx) => {
          const clash = await tx.game.findFirst({
            where: {
              mode: "PVP",
              endedAt: null,
              OR: [
                { whitePlayerId: { in: [user.id, partner.id] } },
                { blackPlayerId: { in: [user.id, partner.id] } },
              ],
            },
          });

          if (clash) {
            return null;
          }

          return tx.game.create({
            data: {
              mode: "PVP",
              whitePlayerId: userIsWhite ? user.id : partner.id,
              blackPlayerId: userIsWhite ? partner.id : user.id,
              moves: [],
              currentFen: toFen(createGame().position),
              // Both sides queued for the same clock; this is that clock.
              ...initialClockData(timeControl),
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === SERIALIZATION_FAILURE
      ) {
        row = null;
      } else {
        throw error;
      }
    }

    if (row === null) {
      // One of us already has a live game. Whoever it is resumes it on their
      // next poll; if it isn't us, the heartbeat puts us back in line.
      await matchmaking.heartbeat(user.id, timeControl);
      return { status: "waiting", game: null };
    }

    return {
      status: "matched",
      game: view(row, replay(row), userIsWhite ? "w" : "b", null, {
        username: partner.username,
        title: partner.equippedTitle?.label ?? null,
      }),
    };
  } finally {
    // Whatever the create's fate, release both players from the pairing
    // marker — on a failure they re-enqueue on their next poll.
    await matchmaking.completePairing(user.id, partnerId);
  }
}

/**
 * Stop searching. Idempotent, so a retry or a double-escape costs nothing.
 *
 * Returns false when a pairing for this player is already in flight: the queue
 * entry is gone either way, but a game is about to exist, and claiming "left"
 * would be a lie. The unwanted game can be aborted before its first move.
 */
export async function leavePvpQueue(user: User): Promise<boolean> {
  await matchmaking.leave(user.id);
  return !(await matchmaking.isPairing(user.id));
}

export async function getGame(gameId: string, user: User): Promise<GameView> {
  const { row, game, color, opponent } = await loadFor(db, gameId, user.id);
  return view(row, game, color, null, opponent);
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
  // Stamped before any work: this is the moment the mover's move arrived, and
  // a timed game charges their clock for the gap since it last started. Taken
  // ahead of `findBestMove` so the human is never billed for the bot's CPU.
  const now = Date.now();

  // Everything up to and including the engine's reply runs before the
  // transaction opens: `findBestMove` is a synchronous minimax that can chew
  // real time, and running it inside a serializable transaction would spend
  // the transaction timeout on CPU and widen the conflict window for every
  // concurrent request. Nothing decided out here is trusted at commit time —
  // the guards are re-run on the live row inside the transaction.
  const {
    row,
    game: loaded,
    color,
    opponent,
  } = await loadFor(db, input.gameId, input.user.id);

  if (row.endedAt !== null) {
    throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
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

  // In a PvP game there is no reply to make here: the opponent's move
  // arrives on their own request, and our client learns of it by polling.
  let aiMove: MoveView | null = null;

  if (row.mode === "AI" && !isGameOver(game.status)) {
    const reply = findBestMove(
      game.position,
      toEngineDifficulty(row.difficulty ?? "MEDIUM"),
    );

    if (reply) {
      game = play(game, reply);
      aiMove = fromHistory(game.history[game.history.length - 1]!);
    }
  }

  // The next turn starts when this request's last move was produced: at
  // arrival for a PvP move, but only after the search when the bot replied —
  // dating it from arrival would fold the bot's think time into the human's
  // next turn, and on a hard difficulty that bleeds their clock dry.
  const nextTurnStartedAt = aiMove !== null ? new Date() : new Date(now);

  const result = await serializable(async (tx) => {
    // The pre-transaction read is stale by definition. Re-run the
    // compare-and-set against the live row: a request that landed meanwhile
    // moved the ply (or ended the game), and this one must conflict rather
    // than overwrite it. Moves are append-only, so an equal length inside a
    // serializable transaction means the same prefix this move was computed on.
    const fresh = await tx.game.findUnique({ where: { id: row.id } });

    if (!fresh || fresh.endedAt !== null) {
      throwProblem(HttpStatusCodes.CONFLICT, "This game is already over");
    }

    if (input.ply !== fresh.moves.length) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `The board has moved on: you played from ply ${input.ply}, the game is at ply ${fresh.moves.length}. Refetch the game.`,
      );
    }

    // Clock bookkeeping, computed here so the settle and the plain update below
    // stay one path each whether the game is timed or not.
    let settleClock: ClockState | undefined;
    let clockCommit:
      | { whiteTimeMs: number; blackTimeMs: number; turnStartedAt: Date }
      | undefined;

    const clock = clockState(fresh);
    if (
      clock !== null &&
      fresh.turnStartedAt !== null &&
      fresh.incrementSeconds !== null
    ) {
      const elapsed = Math.max(0, now - fresh.turnStartedAt.getTime());

      // A move played on a fallen flag does not count: settle the position as
      // it stood *before* the move, a loss on time for the side that flagged.
      if (hasFlagged(clock, color, elapsed)) {
        const flagged: ClockState =
          color === "w"
            ? { whiteTimeMs: 0, blackTimeMs: clock.blackTimeMs }
            : { whiteTimeMs: clock.whiteTimeMs, blackTimeMs: 0 };
        const timeoutResult = resultForTimeout(color);

        const rewards =
          fresh.mode === "AI"
            ? await settle(tx, {
                row: fresh,
                game: loaded,
                user: input.user,
                color,
                result: timeoutResult,
                clock: flagged,
              })
            : await settlePvp(tx, {
                row: fresh,
                game: loaded,
                mover: input.user,
                result: timeoutResult,
                clock: flagged,
              });

        const settled = await tx.game.findUniqueOrThrow({
          where: { id: row.id },
        });
        return {
          yourMove,
          aiMove,
          state: view(settled, loaded, color, rewards, opponent),
        };
      }

      // The move stands: bank the mover's remaining time plus the increment,
      // and restart the clock for whoever is now to move. Not flagged, so
      // `clockAfterMove` never returns null here.
      const advanced =
        clockAfterMove({
          clock,
          mover: color,
          elapsedMs: elapsed,
          incrementSeconds: fresh.incrementSeconds,
        }) ?? clock;

      settleClock = advanced;
      clockCommit = {
        whiteTimeMs: advanced.whiteTimeMs,
        blackTimeMs: advanced.blackTimeMs,
        turnStartedAt: nextTurnStartedAt,
      };
    }

    if (isGameOver(game.status)) {
      const result = resultFor(game.status, game.position.turn);

      // `isGameOver` is true and the status is terminal, so a result exists.
      const rewards =
        fresh.mode === "AI"
          ? await settle(tx, {
              row: fresh,
              game,
              user: input.user,
              color,
              result: result!,
              clock: settleClock,
            })
          : await settlePvp(tx, {
              row: fresh,
              game,
              mover: input.user,
              result: result!,
              clock: settleClock,
            });

      const settled = await tx.game.findUniqueOrThrow({
        where: { id: row.id },
      });
      return {
        yourMove,
        aiMove,
        state: view(settled, game, color, rewards, opponent),
      };
    }

    const updated = await tx.game.update({
      where: { id: row.id },
      data: {
        moves: gameMoves(game),
        currentFen: toFen(game.position),
        ...(clockCommit ?? {}),
      },
    });

    return {
      yourMove,
      aiMove,
      state: view(updated, game, color, null, opponent),
    };
  });

  // The abandonment clock measures from the last committed move; see
  // `lastMoveAt`. A settled game no longer needs one.
  if (row.mode === "PVP") {
    if (result.state.endedAt === null) {
      markMoved(row.id, Date.now());
    } else {
      lastMoveAt.delete(row.id);
    }

    // The opponent is watching this game on a stream. Only PvP: an AI game has
    // nobody on the other side to tell, and telling them anyway would spend a
    // Redis write per bot move.
    publishGameChanged(row.id);
  }

  // After the commit, never inside it: a bump inside the transaction could be
  // followed by another request re-filling the cache from a pre-commit read.
  // Null rewards means either the game is still going or a concurrent settle
  // won the race — and the winner does its own invalidating.
  if (result.state.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

export async function resignGame(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    // Resigning a game that is already over is a no-op, not an error: a client
    // retrying a resign it never saw the answer to deserves the same reply.
    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    const resigned = resultForResignation(color);
    const rewards =
      row.mode === "AI"
        ? await settle(tx, { row, game, user, color, result: resigned })
        : await settlePvp(tx, { row, game, mover: user, result: resigned });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  if (result.mode === "PVP") {
    publishGameChanged(gameId);
  }

  // A resignation is a loss: rating and record moved, so the board is stale.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

// No leaderboard invalidation here: an abort settles the row but pays nothing
// and touches no stat the leaderboard shows.
export async function abortGame(gameId: string, user: User): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    // The escape hatch for a misclicked game. Keeping it distinct from a resign
    // is the whole point: an abort must never become a loss on the record.
    // In a PvP game the same rule doubles as the way out of a match whose
    // opponent never showed: no move played, no loss recorded, for either side.
    // What must not have happened is a move by *this* player: when the bot drew
    // white, its opening move is on the row from birth, and counting it would
    // make an AI game as black impossible to ever abort.
    const playerHasMoved =
      row.mode === "AI" && color === "b"
        ? row.moves.length > 1
        : row.moves.length > 0;

    if (playerHasMoved) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "This game is under way. Resign it instead of aborting it.",
      );
    }

    const rewards =
      row.mode === "AI"
        ? await settle(tx, { row, game, user, color, result: "ABORTED" })
        : await settlePvp(tx, { row, game, mover: user, result: "ABORTED" });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  if (result.mode === "PVP") {
    publishGameChanged(gameId);
  }

  return result;
}

/** How long a PvP opponent may sit on their turn before the win can be claimed. */
const CLAIM_VICTORY_AFTER_MS = 5 * 60_000;

/**
 * When each live PvP game last advanced, keyed by game id. The `Game` row
 * carries no updated-at column, so the abandonment clock runs here — in
 * memory, single-process by construction like the matchmaking queue. Entries
 * are written on every committed PvP move, dropped when a game settles, and
 * lost on a restart, which `lastActivityAt` answers by restarting the clock:
 * a restart can delay a claim, never award one against an opponent who moved
 * just before it.
 */
const lastMoveAt = new Map<string, number>();

/**
 * An entry only matters for the 5-minute claim window that follows a move, so
 * one that has not advanced in far longer belongs to a game that was abandoned
 * without ever settling — an untimed PvP game both players walked away from
 * leaves its entry behind forever, since only a settlement drops it. Sweeping
 * such entries is safe under the same guarantee a restart gives: a game that
 * later resumes just has its clock re-based to `now` by `lastActivityAt`, which
 * can only delay a claim, never award one. Generous so a genuinely long think
 * on an untimed board is never evicted out from under an active game.
 */
const LAST_MOVE_STALE_MS = 60 * 60_000;
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweepAt = 0;

/** Record a PvP move's time, opportunistically evicting long-dead entries. */
function markMoved(gameId: string, at: number): void {
  lastMoveAt.set(gameId, at);

  if (at - lastSweepAt < SWEEP_INTERVAL_MS) {
    return;
  }
  lastSweepAt = at;
  for (const [id, when] of lastMoveAt) {
    if (at - when > LAST_MOVE_STALE_MS) {
      lastMoveAt.delete(id);
    }
  }
}

/** The last time `row` demonstrably advanced. */
function lastActivityAt(row: GameRow): number {
  const tracked = lastMoveAt.get(row.id);
  if (tracked !== undefined) {
    return tracked;
  }

  // A board with no moves has not advanced since its creation, which the row
  // does record durably.
  if (row.moves.length === 0) {
    return row.startedAt.getTime();
  }

  const now = Date.now();
  lastMoveAt.set(row.id, now);
  return now;
}

/**
 * Claim the win in a PvP game whose opponent has walked away.
 *
 * The eligibility bar is deliberately high — the opponent must be on the move
 * and must have let the abandonment clock run out — because a claim settles a
 * rated loss on someone who never agreed to one. Settlement itself is exactly
 * a resignation by the absent side, so ratings, payouts and the ledger come
 * out identical to the opponent having resigned.
 */
export async function claimVictory(
  gameId: string,
  user: User,
): Promise<GameView> {
  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    // Like a resign: claiming a game that is already over returns it as it
    // stands, so a client retrying a claim it never saw the answer to is safe.
    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    if (row.mode !== "PVP") {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "Only an online game can be claimed. The bot never abandons; resign instead.",
      );
    }

    if (game.position.turn === color) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "It is your turn: play a move, or resign.",
      );
    }

    const idleMs = Date.now() - lastActivityAt(row);
    if (idleMs < CLAIM_VICTORY_AFTER_MS) {
      const wait = Math.ceil((CLAIM_VICTORY_AFTER_MS - idleMs) / 1000);
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `Your opponent still has ${wait}s to move before the win can be claimed.`,
      );
    }

    const absent: Color = color === "w" ? "b" : "w";
    const rewards = await settlePvp(tx, {
      row,
      game,
      mover: user,
      result: resultForResignation(absent),
    });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  // Always PvP by the guard above: the absent opponent's stream, if they left
  // one open, learns the game is over rather than hanging on a dead position.
  publishGameChanged(gameId);

  // A claim is a rated win, so the board is stale — same as a resignation.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
}

/**
 * Settle a timed game whose running clock has fallen.
 *
 * Either player may call it; the server, not the caller, decides who flagged —
 * the side to move is the one whose clock is running, so it settles as a loss
 * for them whether that is the caller (their own flag fell while they sat on it)
 * or the opponent (whose walk-away the caller is cashing in). The move path
 * catches a flag the moment the flagged player tries to move; this catches the
 * one they never do.
 */
export async function flagGame(gameId: string, user: User): Promise<GameView> {
  const now = Date.now();

  const result = await serializable(async (tx) => {
    const { row, game, color, opponent } = await loadFor(tx, gameId, user.id);

    // Idempotent like resign and claim: a game already settled comes back as it
    // stands, so a retry the client never saw the answer to is safe.
    if (row.endedAt !== null) {
      return view(row, game, color, null, opponent);
    }

    const clock = clockState(row);
    if (clock === null || row.turnStartedAt === null) {
      throwProblem(
        HttpStatusCodes.CONFLICT,
        "This game has no clock to run out.",
      );
    }

    // The running clock is the side to move's; that is who can flag right now.
    const ticking = game.position.turn;
    const elapsed = Math.max(0, now - row.turnStartedAt.getTime());

    if (!hasFlagged(clock, ticking, elapsed)) {
      const left = Math.ceil((timeOf(clock, ticking) - elapsed) / 1000);
      throwProblem(
        HttpStatusCodes.CONFLICT,
        `There is still ${left}s on the clock. Nobody has flagged yet.`,
      );
    }

    const flagged: ClockState =
      ticking === "w"
        ? { whiteTimeMs: 0, blackTimeMs: clock.blackTimeMs }
        : { whiteTimeMs: clock.whiteTimeMs, blackTimeMs: 0 };
    const timeoutResult = resultForTimeout(ticking);

    const rewards =
      row.mode === "AI"
        ? await settle(tx, {
            row,
            game,
            user,
            color,
            result: timeoutResult,
            clock: flagged,
          })
        : await settlePvp(tx, {
            row,
            game,
            mover: user,
            result: timeoutResult,
            clock: flagged,
          });

    const settled = await tx.game.findUniqueOrThrow({ where: { id: row.id } });
    return view(settled, game, color, rewards, opponent);
  });

  lastMoveAt.delete(gameId);

  if (result.mode === "PVP") {
    publishGameChanged(gameId);
  }

  // A flag settles a decisive game: rating and record moved, so the board is
  // stale, exactly as a resignation or a claim leaves it.
  if (result.rewards !== null) {
    await invalidateCache("leaderboard");
  }

  return result;
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

/** The caller's finished games, newest first, cursor-paginated on `(endedAt, id)`. */
export async function listGames(input: {
  user: User;
  limit: number;
  cursor?: { ts: Date; id: string };
  result?: GameResult;
}): Promise<{ games: GameSummary[]; nextCursor: string | null }> {
  const rows = await db.game.findMany({
    where: {
      OR: [{ whitePlayerId: input.user.id }, { blackPlayerId: input.user.id }],
      endedAt: { not: null },
      ...(input.result ? { result: input.result } : {}),
      // Strictly after the cursor row in `(endedAt, id)` order: ties on the
      // timestamp fall through to the id, so rows that settled in the same
      // instant are never skipped at a page boundary.
      ...(input.cursor
        ? {
            AND: [
              {
                OR: [
                  { endedAt: { lt: input.cursor.ts } },
                  { endedAt: input.cursor.ts, id: { lt: input.cursor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ endedAt: "desc" }, { id: "desc" }],
    // One extra row tells us whether another page exists without a second query.
    take: input.limit + 1,
  });

  const page = rows.slice(0, input.limit);
  const last = rows.length > input.limit ? page[page.length - 1] : null;

  return {
    games: page.map((row) => summarize(row, input.user.id)),
    // The `<iso>_<id>` compound `paginationQuerySchema` validates and
    // `decodeCursor` splits. Opaque to clients, which round-trip it verbatim.
    nextCursor: last?.endedAt
      ? `${last.endedAt.toISOString()}_${last.id}`
      : null,
  };
}

/**
 * The archival PGN of a finished game the caller played.
 *
 * Read off the row rather than rebuilt: `claimGame` wrote it at settlement with
 * the players' names as they stood then, and regenerating it here would quietly
 * rename anyone who has changed their username since.
 */
export async function getGamePgn(
  gameId: string,
  user: User,
): Promise<{ pgn: string; filename: string }> {
  const { row, game } = await loadFor(db, gameId, user.id);

  if (row.pgn === null) {
    throwProblem(
      HttpStatusCodes.CONFLICT,
      "This game is still going. There is a PGN once it is over.",
    );
  }

  const date = row.startedAt.toISOString().slice(0, 10);

  return {
    pgn: row.pgn,
    // Enough to tell two downloads apart in a folder, and safe as a filename on
    // every platform without escaping.
    filename: `openchess-${date}-${row.id.slice(-6)}-${game.history.length}ply.pgn`,
  };
}

export type SpectatorView = {
  id: string;
  white: OpponentView | null;
  black: OpponentView | null;
  fen: string;
  turn: Color;
  status: Game["status"];
  ply: number;
  history: string[];
  captured: { byWhite: string[]; byBlack: string[] };
  materialBalance: number;
  result: GameResult | null;
  timeControl: TimeControlView | null;
  clock: ClockView | null;
  startedAt: string;
  endedAt: string | null;
};

/** Both players' public faces, for a board nobody watching is playing on. */
async function playersOf(
  row: GameRow,
): Promise<{ white: OpponentView | null; black: OpponentView | null }> {
  const ids = [row.whitePlayerId, row.blackPlayerId].filter(
    (id): id is string => id !== null,
  );

  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      username: true,
      equippedTitle: { select: { label: true } },
    },
  });

  const byId = new Map(
    users.map((user) => [
      user.id,
      { username: user.username, title: user.equippedTitle?.label ?? null },
    ]),
  );

  return {
    white: row.whitePlayerId ? (byId.get(row.whitePlayerId) ?? null) : null,
    black: row.blackPlayerId ? (byId.get(row.blackPlayerId) ?? null) : null,
  };
}

function spectatorView(
  row: GameRow,
  game: Game,
  players: { white: OpponentView | null; black: OpponentView | null },
): SpectatorView {
  const captured = capturedPieces(game);

  return {
    id: row.id,
    white: players.white,
    black: players.black,
    fen: toFen(game.position),
    turn: game.position.turn,
    status: game.status,
    ply: game.history.length,
    history: game.history.map((entry) => entry.san),
    captured: { byWhite: captured.byWhite, byBlack: captured.byBlack },
    materialBalance: materialBalance(game.position),
    result: row.result,
    timeControl: timeControlView(row),
    clock: clockView(row, game),
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

/**
 * Watch a game you are not playing in.
 *
 * Deliberately a different shape from `GameView` rather than the same one with
 * fields blanked: a spectator has no colour, no legal moves and no rewards, and
 * handing them a view that claims otherwise would invite a client to offer
 * actions the server will refuse. There is nothing here a player could not
 * already see — an online game is public while it is being played — and the
 * legal-move list, the one thing a watcher could use to play someone else's
 * board, is simply absent.
 *
 * Only PvP games can be watched. An AI game is a private practice board; the
 * bot has no audience and its human did not sign up for one.
 */
export async function watchGame(gameId: string): Promise<SpectatorView> {
  const row = await db.game.findUnique({ where: { id: gameId } });

  if (!row) {
    throwProblem(HttpStatusCodes.NOT_FOUND, "No such game");
  }

  if (row.mode !== "PVP") {
    throwProblem(
      HttpStatusCodes.FORBIDDEN,
      "Only online games can be watched",
    );
  }

  return spectatorView(row, replay(row), await playersOf(row));
}

export type LiveGameSummary = {
  id: string;
  white: OpponentView | null;
  black: OpponentView | null;
  /** The two players' ratings, for sorting the list by how good the game is. */
  whiteRating: number | null;
  blackRating: number | null;
  ply: number;
  timeControl: TimeControlView | null;
  startedAt: string;
};

/** How many live games the watch list will show at once. */
const MAX_LIVE_GAMES = 30;

/**
 * The games being played right now, best first.
 *
 * "Best" is the lower of the two ratings: a 2000 playing an 800 is a less
 * interesting board than two 1500s, and ranking on the average would put it
 * above them. Games that have not started — paired but with no move played —
 * are left out; there is nothing to watch yet, and half of them are abandoned
 * pairings that will be aborted.
 */
export async function listLiveGames(): Promise<LiveGameSummary[]> {
  const rows = await db.game.findMany({
    where: { mode: "PVP", endedAt: null },
    orderBy: { startedAt: "desc" },
    // Over-fetched: the ply filter and the rating sort both happen below, and a
    // window this size covers any plausible number of concurrent games.
    take: MAX_LIVE_GAMES * 4,
    include: {
      whitePlayer: {
        select: {
          username: true,
          equippedTitle: { select: { label: true } },
          stats: { select: { rating: true } },
        },
      },
      blackPlayer: {
        select: {
          username: true,
          equippedTitle: { select: { label: true } },
          stats: { select: { rating: true } },
        },
      },
    },
  });

  const face = (
    player: {
      username: string;
      equippedTitle: { label: string } | null;
    } | null,
  ): OpponentView | null =>
    player
      ? { username: player.username, title: player.equippedTitle?.label ?? null }
      : null;

  return rows
    .filter((row) => row.moves.length > 0)
    .map((row) => ({
      id: row.id,
      white: face(row.whitePlayer),
      black: face(row.blackPlayer),
      whiteRating: row.whitePlayer?.stats?.rating ?? null,
      blackRating: row.blackPlayer?.stats?.rating ?? null,
      ply: row.moves.length,
      timeControl: timeControlView(row),
      startedAt: row.startedAt.toISOString(),
    }))
    .sort((a, b) => {
      const strength = (game: LiveGameSummary) =>
        Math.min(game.whiteRating ?? 0, game.blackRating ?? 0);
      return strength(b) - strength(a);
    })
    .slice(0, MAX_LIVE_GAMES);
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
