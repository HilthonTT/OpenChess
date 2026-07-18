import { db } from "@openchess/database/client";
import type { Prisma } from "@openchess/database";

/**
 * Seed the achievement and title catalogs. Run with `bun run db:seed`.
 *
 * Everything is upserted by `code` — the stable key the unlock rules and the
 * store reference — so reruns rewrite copy, rewards and prices in place
 * without duplicating rows or touching what players have already unlocked.
 *
 * Every code in `game/achievements.ts` RULES has a row here: a rule whose code
 * has no row unlocks nothing, silently.
 */

type AchievementSeed = Omit<Prisma.AchievementCreateInput, "unlockedBy">;

const ACHIEVEMENTS: AchievementSeed[] = [
  {
    code: "FIRST_WIN",
    name: "First Victory",
    description: "Win your first game.",
    xpReward: 50,
    coinReward: 25,
  },
  {
    code: "TEN_WINS",
    name: "Club Player",
    description: "Win 10 games.",
    xpReward: 150,
    coinReward: 75,
  },
  {
    code: "HUNDRED_WINS",
    name: "Centurion",
    description: "Win 100 games.",
    xpReward: 1000,
    coinReward: 500,
  },
  {
    code: "WIN_STREAK_3",
    name: "On a Roll",
    description: "Win 3 games in a row.",
    xpReward: 100,
    coinReward: 50,
  },
  {
    code: "WIN_STREAK_5",
    name: "Hot Streak",
    description: "Win 5 games in a row.",
    xpReward: 250,
    coinReward: 100,
  },
  {
    code: "WIN_STREAK_10",
    name: "Unstoppable",
    description: "Win 10 games in a row.",
    xpReward: 750,
    coinReward: 300,
  },
  {
    code: "BEAT_EASY",
    name: "Warming Up",
    description: "Beat the engine on easy.",
    xpReward: 25,
    coinReward: 10,
  },
  {
    code: "BEAT_MEDIUM",
    name: "Fair Fight",
    description: "Beat the engine on medium.",
    xpReward: 75,
    coinReward: 40,
  },
  {
    code: "BEAT_HARD",
    name: "Giant Slayer",
    description: "Beat the engine on hard.",
    xpReward: 300,
    coinReward: 150,
  },
  {
    code: "CHECKMATE_ARTIST",
    name: "Checkmate Artist",
    description: "Win a game by delivering checkmate.",
    xpReward: 50,
    coinReward: 25,
  },
  {
    code: "QUICK_MATE",
    name: "Scholar's Mate",
    description: "Deliver checkmate within the first ten moves.",
    xpReward: 400,
    coinReward: 200,
    secret: true,
  },
  {
    code: "IRON_WALL",
    name: "Iron Wall",
    description: "Hold the hard engine to a draw.",
    xpReward: 350,
    coinReward: 150,
    secret: true,
  },
];

type TitleSeed = Omit<Prisma.TitleCreateInput, "ownedBy" | "equippedBy">;

const TITLES: TitleSeed[] = [
  {
    code: "PAWN_PUSHER",
    label: "Pawn Pusher",
    description: "Every journey begins with e4.",
    price: 50,
    rarity: "COMMON",
    requiredLevel: 1,
  },
  {
    code: "CLUB_REGULAR",
    label: "Club Regular",
    description: "A familiar face at the board.",
    price: 100,
    rarity: "COMMON",
    requiredLevel: 2,
  },
  {
    code: "TACTICIAN",
    label: "Tactician",
    description: "Sees two moves further than you.",
    price: 300,
    rarity: "RARE",
    requiredLevel: 5,
  },
  {
    code: "STRATEGIST",
    label: "Strategist",
    description: "Plays the position, not the piece.",
    price: 500,
    rarity: "RARE",
    requiredLevel: 8,
  },
  {
    code: "MAESTRO",
    label: "Maestro",
    description: "The board is an instrument.",
    price: 1200,
    rarity: "EPIC",
    requiredLevel: 12,
  },
  {
    code: "GRANDMASTER",
    label: "Grandmaster",
    description: "The title everyone else is saving up for.",
    price: 5000,
    rarity: "LEGENDARY",
    requiredLevel: 20,
  },
  // Achievement rewards: listed in the store but never for sale.
  {
    code: "CENTURION",
    label: "Centurion",
    description: "Awarded for winning 100 games.",
    price: 0,
    rarity: "EPIC",
    isPurchasable: false,
  },
  {
    code: "THE_WALL",
    label: "The Wall",
    description: "Awarded for holding the hard engine to a draw.",
    price: 0,
    rarity: "RARE",
    isPurchasable: false,
  },
];

for (const achievement of ACHIEVEMENTS) {
  const { code, ...rest } = achievement;
  await db.achievement.upsert({
    where: { code },
    update: rest,
    create: achievement,
  });
}
console.log(`Seeded ${ACHIEVEMENTS.length} achievements.`);

for (const title of TITLES) {
  const { code, ...rest } = title;
  await db.title.upsert({
    where: { code },
    update: rest,
    create: title,
  });
}
console.log(`Seeded ${TITLES.length} titles.`);

await db.$disconnect();
