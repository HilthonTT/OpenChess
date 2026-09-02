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
export async function claimGame(
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
      // An offer outlives nothing: whatever ended the game — agreement, mate, a
      // fallen flag — answered both of them, and a takeback of a move in a game
      // that is over is not a thing anyone can accept. Cleared here rather than
      // in each caller because this is the one write every settlement goes
      // through.
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
  // result still moved the leaderboard and unlocked count-based trophies for
  // free. That is the win-trading farm: two accounts queue, the loser resigns at
  // move one, and the winner banks a win, a rating bump and achievement coins at
  // no cost. Settle such a game as a no-contest — like an abort, nobody's record
  // moves. A genuine fast win is a checkmate (fool's/scholar's mate) and is
  // exempt, matching how the ply floor already reasons about "not really a game".
  //
  // Draws are held to the same bar, which costs nothing and closes the same farm
  // in agreement's clothing: two accounts queue and shake hands at move one,
  // banking a `draws` apiece forever. No legitimate draw is caught by this —
  // stalemate, repetition and insufficient material are all unreachable inside
  // ten plies, so a sub-floor draw can only be one that was agreed.
  if (input.plies < MIN_REWARDED_PLIES && !input.byCheckmate) {
    return nothingEarned(user, stats.rating);
  }

  const after = statsAfter(stats, outcome, input.newRating);
  await tx.userStats.update({ where: { userId: user.id }, data: after });

  // The rating curve, written beside the scalar it is the history of, so a point
  // can never exist for a rating that was not banked.
  //
  // Only when the rating actually moved. An unrated AI game and a draw between
  // equals both land here having changed nothing, and a row for either would put
  // a flat point on the chart that reports a game rather than a change — which
  // is not what the series is for. That the settle path runs once per game per
  // player (`claimGame`) is what makes this exactly-once.
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
export async function settle(
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

/**
 * Finish a PvP game and pay both sides, in one transaction.
 *
 * Both ratings are read before either is written, so each side's Elo moves
 * against the rating their opponent actually brought into the game. The return
 * value is the *mover's* reward view — the opponent's payout happens here too,
 * but they learn the game is over from their next poll, which reports the
 * result without a payout breakdown.
 */
export async function settlePvp(
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
