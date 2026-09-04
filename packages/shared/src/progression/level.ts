const XP_COEFFICIENT = 50;

export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.floor(level));
  return XP_COEFFICIENT * (clamped - 1) ** 2;
}

export function levelFor(experience: number): number {
  if (experience <= 0) {
    return 1;
  }
  return Math.floor(Math.sqrt(experience / XP_COEFFICIENT)) + 1;
}

export type LevelProgress = {
  level: number;
  experience: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
  levelSpan: number;
  fraction: number;
};

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
