import type { Outcome } from "./td-leaf";

export type MatchResult = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  score: number;
  elo: number;
};

const ELO_LIMIT = 800;

export function eloDifference(score: number): number {
  if (score <= 0) {
    return -ELO_LIMIT;
  }
  if (score >= 1) {
    return ELO_LIMIT;
  }
  const elo = 400 * Math.log10(score / (1 - score));
  return Math.max(-ELO_LIMIT, Math.min(ELO_LIMIT, elo));
}

export function tallyMatch(outcomes: readonly Outcome[]): MatchResult {
  let wins = 0;
  let draws = 0;
  let losses = 0;

  for (const outcome of outcomes) {
    if (outcome === 1) {
      wins += 1;
    } else if (outcome === -1) {
      losses += 1;
    } else {
      draws += 1;
    }
  }

  const games = outcomes.length;
  const score = games === 0 ? 0.5 : (wins + draws / 2) / games;

  return { games, wins, draws, losses, score, elo: eloDifference(score) };
}
