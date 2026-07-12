/**
 * The XP curve.
 *
 * Lives in the shared package on purpose: the server writes `User.level` (the
 * schema stores it only so the leaderboard can sort without recomputing), and
 * the client renders the progress bar. Both have to agree on the curve, and the
 * only way to guarantee that is to have exactly one of it.
 */

/**
 * Quadratic: each level costs a little more than the last, so early levels come
 * quickly and later ones stay meaningful. Level L begins at `50 * (L-1)²` XP —
 * L2 at 50, L5 at 800, L10 at 4050.
 */
const XP_COEFFICIENT = 50;

/** Total XP required to *reach* `level`. Level 1 starts at zero. */
export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.floor(level));
  return XP_COEFFICIENT * (clamped - 1) ** 2;
}

/** The level a player with `experience` XP has reached. Never below 1. */
export function levelFor(experience: number): number {
  if (experience <= 0) {
    return 1;
  }
  return Math.floor(Math.sqrt(experience / XP_COEFFICIENT)) + 1;
}

export type LevelProgress = {
  level: number;
  experience: number;
  /** XP earned since this level began. */
  xpIntoLevel: number;
  /** XP still needed to reach the next level. */
  xpToNextLevel: number;
  /** The size of this level's band, in XP. */
  levelSpan: number;
  /** `xpIntoLevel / levelSpan`, in [0, 1) — ready to multiply by a bar width. */
  fraction: number;
};

/** Everything a progress bar needs, derived from a raw XP total. */
export function levelProgress(experience: number): LevelProgress {
  const total = Math.max(0, Math.floor(experience));
  const level = levelFor(total);

  const floor = xpForLevel(level);
  const ceiling = xpForLevel(level + 1);
  const levelSpan = ceiling - floor;
  const xpIntoLevel = total - floor;

  return {
    level,
    experience: total,
    xpIntoLevel,
    xpToNextLevel: ceiling - total,
    levelSpan,
    fraction: levelSpan === 0 ? 0 : xpIntoLevel / levelSpan,
  };
}
