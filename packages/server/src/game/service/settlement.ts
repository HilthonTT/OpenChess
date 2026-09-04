import type {
  Prisma,
  Difficulty,
  Game as GameRow,
  GameResult,
  User,
  UserStats,
} from "@openchess/database";
import { gameMoves, toFen, type Color, type Game } from "@openchess/shared";
import { unlockAchievements } from "../../player/unlocks";
import { satisfiedCodes } from "../achievements";
import {
  levelFor,
  outcomeFor,
  ratingAfter,
  ratingAgainst,
  rewardFor,
  rewardForPvp,
  MIN_REWARDED_PLIES,
  statsAfter,
  type ClockState,
  type Outcome,
  type Reward,
} from "../rules";
import { type RewardView, pgnFor, pvpPgnFor } from "./views";

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

export async function claimGame(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    result: GameResult;
    pgn: string;
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
      drawOfferedBy: null,
      takebackOfferedBy: null,
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

async function payoutPlayer(
  tx: Prisma.TransactionClient,
  input: {
    gameId: string;
    user: User;
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

  if (input.plies < MIN_REWARDED_PLIES && !input.byCheckmate) {
    return nothingEarned(user, stats.rating);
  }

  const after = statsAfter(stats, outcome, input.newRating);
  await tx.userStats.update({ where: { userId: user.id }, data: after });

  if (after.rating !== stats.rating) {
    await tx.ratingSnapshot.create({
      data: {
        userId: user.id,
        rating: after.rating,
        delta: after.rating - stats.rating,
        gameId: input.gameId,
      },
    });
  }

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

export async function settle(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    user: User;
    color: Color;
    result: GameResult;
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

  if (!claimed) {
    return null;
  }

  const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });

  const stats = await tx.userStats.findUniqueOrThrow({
    where: { userId: user.id },
  });

  const outcome = outcomeFor(result, color);

  if (outcome === null) {
    return nothingEarned(fresh, stats.rating);
  }

  return payoutPlayer(tx, {
    gameId: row.id,
    user: fresh,
    stats,
    outcome,
    newRating: ratingAfter(stats.rating, outcome, difficulty),
    base: rewardFor({
      result,
      color,
      difficulty,
      plies,
      takebacks: row.takebacks,
    }),
    difficulty,
    plies,
    byCheckmate: game.status === "checkmate",
  });
}

export async function settlePvp(
  tx: Prisma.TransactionClient,
  input: {
    row: GameRow;
    game: Game;
    mover: User;
    result: GameResult;
    clock?: ClockState;
  },
): Promise<RewardView | null> {
  const { row, game, mover, result } = input;

  const plies = game.history.length;
  const byCheckmate = game.status === "checkmate";

  const sides: Array<{ color: Color; userId: string | null }> = [
    { color: "w", userId: row.whitePlayerId },
    { color: "b", userId: row.blackPlayerId },
  ];

  const players: Array<{ color: Color; user: User; stats: UserStats }> = [];

  for (const side of sides) {
    if (side.userId === null) {
      continue;
    }

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
