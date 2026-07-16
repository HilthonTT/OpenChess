export const TAGS = {
  ACHIEVEMENTS: "Achievements",
  GAMES: "Games",
  LEADERBOARD: "Leaderboard",
  ME: "Me",
  STORE: "Store",
  BILLING: "Billing",
} as const;

Object.freeze(TAGS);

export type TagKey = keyof typeof TAGS;
export type Tag = (typeof TAGS)[TagKey];

export const TAG_LIST = Object.values(TAGS);
