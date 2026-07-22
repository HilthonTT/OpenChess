export const TAGS = {
  ROOT: "Root",
  ACHIEVEMENTS: "Achievements",
  GAMES: "Games",
  LEADERBOARD: "Leaderboard",
  ME: "Me",
  STORE: "Store",
  BILLING: "Billing",
  AUTH: "Auth",
  HEALTH: "Health",
} as const;

Object.freeze(TAGS);

export type TagKey = keyof typeof TAGS;
export type Tag = (typeof TAGS)[TagKey];

export const TAG_LIST = Object.values(TAGS);
