// Netrics Phase 3 Lock Advisor, Matchup & Bench Swing Engine — spec Phase 3 v1.0 §4, §5, §6 (FROZEN).
// Pure TypeScript module with zero UI or network dependencies.
// Never uses season mean as a target or projection; never reads GameLog.expectedTotal.

import { analyzePlayer, type ScoredGame } from "../analytics/index.js";
import {
  STARTER_SLOTS,
  type GameLog,
  type LockRecord,
  type Player,
  type StarterSlot,
  type WeekRecord,
} from "../data/types.js";
import { round2 } from "../scoring/index.js";

export type AdvisorStatus = "LOCKED" | "NO_BANKED_SCORE" | "NO_GAMES_LEFT" | "DECISION";
export type AdvisorRecommendation = "LOCK" | "RIDE" | "LEAN_RIDE" | null;

export interface LockDecisionEvaluation {
  sleeperId: string;
  status: AdvisorStatus;
  recommendation: AdvisorRecommendation;
  /** Banked score B: lock.lockedTotal if locked, else latest completed leg game total, else null. */
  bankedScore: number | null;
  /** Date of the banked game (lock.gameDate if locked, else latestLegGame.log.date, else null). */
  bankedGameDate: string | null;
  /** Opponent of the banked game if found in distribution/legGames, else null. */
  bankedOpponent: string | null;
  /** Active lock record for this player in this leg, or null if unlocked. */
  lock: LockRecord | null;
  /** Latest completed game in this leg, or null if none played in [startDate, endDate]. */
  latestLegGame: ScoredGame | null;
  /** When locked and latestLegGame exists, round2(lock.lockedTotal - latestLegGame.total); else 0. */
  lockGainVsLatest: number;
  /** Remaining game dates for this player in this leg. */
  remainingGameDates: string[];
  /** Count of remaining games n = remainingGameDates.length. */
  remainingGamesCount: number;
  /** Total logged games N in the player's season distribution. */
  gamesPlayed: number;
  /** Player season ceiling (max total), or null if N === 0. */
  ceiling: number | null;
  /** Player season floor (min total), or null if N === 0. */
  floor: number | null;
  /** Count of season games with total > B (strict >). */
  beatCount: number;
  /** Count of season games with total <= B (includes ties total === B). */
  nonBeatCount: number;
  /** beatCount / gamesPlayed (0..1). */
  beatRate: number;
  /** 1 - (1 - beatRate)^n when n > 0 and B !== null, else 0. */
  pAnyBeat: number;
  /** Mean of (g.total - B) over beatingGames, rounded to 2 decimals. */
  meanUpside: number;
  /** Mean of (B - g.total) over nonBeatingGames (including ties with 0 shortfall), rounded to 2 decimals. */
  meanShortfall: number;
  /** Expected value of sequential first-beat stopping strategy over n remaining games, rounded to 2 decimals. */
  rideEV: number;
  /** True when ceiling !== null && B !== null && B >= ceiling - 2.00. */
  nearCeiling: boolean;
  /** Max possible gain to ceiling: Math.max(0, round2(ceiling - B)) when ceiling & B present, else 0. */
  maxGainToCeiling: number;
}

export interface StarterAdvisorRow {
  slotIndex: number;
  slot: StarterSlot;
  player: Player;
  evaluation: LockDecisionEvaluation;
}

export interface StarterMatchupBound {
  slotIndex: number;
  slot: StarterSlot;
  player: Player;
  bankedScore: number | null;
  isLocked: boolean;
  remainingGamesCount: number;
  bestCase: number;
  worstCase: number;
}

export interface MatchupEvaluation {
  leg: number;
  userTotal: number;
  opponentTotal: number;
  margin: number;
  startersWithRemainingGames: number;
  totalStarterRemainingGames: number;
  userBestCase: number;
  userWorstCase: number;
  starterBounds: StarterMatchupBound[];
}

export interface BenchSwingRecommendation {
  benchPlayer: Player;
  benchValue: number;
  benchGameDate: string | null;
  benchOpponent: string | null;
  benchLocked: boolean;
  benchRemainingGames: number;
  benchRideEV: number;
  slotIndex: number;
  slot: StarterSlot;
  starterPlayer: Player;
  starterBanked: number | null;
  starterLocked: boolean;
  swing: number;
}

/**
 * Checks whether a player with `positions` qualifies for Sleeper starter slot `slot`
 * per Phase 3 v1.0 §6 (`["PG", "SG", "G", "SF", "PF", "F", "C", "UTIL", "UTIL"]`).
 */
export function isEligibleForSlot(positions: string[], slot: StarterSlot | string): boolean {
  if (slot === "UTIL") return true;
  if (slot === "G") return positions.includes("PG") || positions.includes("SG");
  if (slot === "F") return positions.includes("SF") || positions.includes("PF");
  return positions.includes(slot);
}

/**
 * Evaluates a single player's Lock Advisor metrics and recommendation for a given leg
 * per Phase 3 v1.0 §4.1 & §4.2.
 */
export function evaluateLockDecision(params: {
  sleeperId: string;
  distribution: ScoredGame[];
  legGames: ScoredGame[];
  lock: LockRecord | null;
  remainingGameDates: string[];
}): LockDecisionEvaluation {
  const { sleeperId, distribution, legGames, lock, remainingGameDates } = params;
  const N = distribution.length;
  const n = remainingGameDates.length;

  let ceiling: number | null = null;
  let floor: number | null = null;
  if (N > 0) {
    const totals = distribution.map((g) => g.total);
    ceiling = Math.max(...totals);
    floor = Math.min(...totals);
  }

  // Latest completed game in this leg (by date)
  const sortedLegGames = [...legGames].sort((a, b) => b.log.date.localeCompare(a.log.date));
  const latestLegGame = sortedLegGames[0] ?? null;

  // 1. Banked Score (B)
  let bankedScore: number | null = null;
  let bankedGameDate: string | null = null;
  let bankedOpponent: string | null = null;

  if (lock !== null) {
    bankedScore = lock.lockedTotal;
    bankedGameDate = lock.gameDate;
    const lockedScored =
      legGames.find((g) => g.log.date === lock.gameDate) ??
      distribution.find((g) => g.log.date === lock.gameDate) ??
      null;
    bankedOpponent = lockedScored?.log.opponent ?? null;
  } else if (latestLegGame !== null) {
    bankedScore = latestLegGame.total;
    bankedGameDate = latestLegGame.log.date;
    bankedOpponent = latestLegGame.log.opponent;
  }

  const lockGainVsLatest =
    lock !== null && latestLegGame !== null ? round2(lock.lockedTotal - latestLegGame.total) : 0;

  // 2. Conditional Distribution Metrics (for any numeric B when N > 0)
  let beatCount = 0;
  let nonBeatCount = 0;
  let beatRate = 0;
  let meanUpsideRaw = 0;
  let meanShortfallRaw = 0;
  let meanUpside = 0;
  let meanShortfall = 0;

  if (bankedScore !== null && N > 0) {
    const B = bankedScore;
    const beatingGames = distribution.filter((g) => g.total > B);
    const nonBeatingGames = distribution.filter((g) => g.total <= B);
    beatCount = beatingGames.length;
    nonBeatCount = nonBeatingGames.length;
    beatRate = beatCount / N;

    meanUpsideRaw =
      beatCount > 0 ? beatingGames.reduce((sum, g) => sum + (g.total - B), 0) / beatCount : 0;
    meanShortfallRaw =
      nonBeatCount > 0
        ? nonBeatingGames.reduce((sum, g) => sum + (B - g.total), 0) / nonBeatCount
        : 0;

    meanUpside = round2(meanUpsideRaw);
    meanShortfall = round2(meanShortfallRaw);
  }

  // 3. Multi-Game Sequential Stopping Probability & Expected Value
  const hasActiveDraws = lock === null && bankedScore !== null && N > 0 && n > 0;
  const pAnyBeat =
    bankedScore !== null && N > 0 && n > 0 ? 1 - Math.pow(1 - beatRate, n) : 0;
  const rideEV = hasActiveDraws
    ? round2(pAnyBeat * meanUpsideRaw - (1 - pAnyBeat) * meanShortfallRaw)
    : 0;

  const nearCeiling = ceiling !== null && bankedScore !== null && bankedScore >= ceiling - 2.0;
  const maxGainToCeiling =
    ceiling !== null && bankedScore !== null ? Math.max(0, round2(ceiling - bankedScore)) : 0;

  // 4. Status & Recommendation Rules (§4.2)
  let status: AdvisorStatus;
  let recommendation: AdvisorRecommendation = null;

  if (lock !== null) {
    status = "LOCKED";
    recommendation = null;
  } else if (bankedScore === null || N === 0) {
    status = "NO_BANKED_SCORE";
    recommendation = null;
  } else if (n === 0) {
    status = "NO_GAMES_LEFT";
    recommendation = null;
  } else {
    status = "DECISION";
    if (rideEV <= 0) {
      recommendation = "LOCK";
    } else if (pAnyBeat >= 0.5) {
      recommendation = "RIDE";
    } else {
      recommendation = "LEAN_RIDE";
    }
  }

  return {
    sleeperId,
    status,
    recommendation,
    bankedScore,
    bankedGameDate,
    bankedOpponent,
    lock,
    latestLegGame,
    lockGainVsLatest,
    remainingGameDates,
    remainingGamesCount: n,
    gamesPlayed: N,
    ceiling,
    floor,
    beatCount,
    nonBeatCount,
    beatRate,
    pAnyBeat,
    meanUpside,
    meanShortfall,
    rideEV,
    nearCeiling,
    maxGainToCeiling,
  };
}

/**
 * Evaluates Lock Advisor for a specific player in a specific week using raw logs and locks.
 */
export function evaluatePlayerForWeek(
  sleeperId: string,
  week: WeekRecord,
  logs: GameLog[],
  locks: LockRecord[],
): LockDecisionEvaluation {
  const analytics = analyzePlayer(sleeperId, logs);
  const legGames = analytics.distribution.filter(
    (g) => g.log.date >= week.startDate && g.log.date <= week.endDate,
  );
  const lock = locks.find((l) => l.sleeperId === sleeperId && l.leg === week.leg) ?? null;
  const remainingGameDates = week.remainingGames[sleeperId] ?? [];
  return evaluateLockDecision({
    sleeperId,
    distribution: analytics.distribution,
    legGames,
    lock,
    remainingGameDates,
  });
}

/**
 * Evaluates all 9 starters in slot order (`STARTER_SLOTS`) for a week.
 */
export function adviseWeek(
  week: WeekRecord,
  players: Player[],
  logs: GameLog[],
  locks: LockRecord[],
): StarterAdvisorRow[] {
  const playerMap = new Map(players.map((p) => [p.sleeperId, p]));
  return week.starters.map((sleeperId, slotIndex) => {
    const slot = (STARTER_SLOTS[slotIndex] ?? "UTIL") as StarterSlot;
    const player = playerMap.get(sleeperId) ?? {
      sleeperId,
      name: `Player ${sleeperId}`,
      team: "UNK",
      positions: [],
      rosterStatus: "starter",
    };
    const evaluation = evaluatePlayerForWeek(sleeperId, week, logs, locks);
    return {
      slotIndex,
      slot,
      player,
      evaluation,
    };
  });
}

/**
 * Computes the Weekly Matchup summary and starter best/worst-case bounds per Phase 3 v1.0 §5.
 */
export function evaluateMatchup(
  week: WeekRecord,
  players: Player[],
  logs: GameLog[],
  locks: LockRecord[],
  opponentPointsOverride?: number,
): MatchupEvaluation {
  const starterRows = adviseWeek(week, players, logs, locks);

  let userTotal = 0;
  let userBestCase = 0;
  let userWorstCase = 0;
  let startersWithRemainingGames = 0;
  let totalStarterRemainingGames = 0;

  const starterBounds: StarterMatchupBound[] = starterRows.map(({ slotIndex, slot, player, evaluation }) => {
    const B = evaluation.bankedScore;
    const n = evaluation.remainingGamesCount;
    const isLocked = evaluation.lock !== null;

    userTotal = round2(userTotal + (B ?? 0));
    if (n > 0) {
      startersWithRemainingGames += 1;
      totalStarterRemainingGames += n;
    }

    let bestCase: number;
    let worstCase: number;

    // §5 rule:
    // If a starter is locked (lock !== null) OR has n === 0 remaining games with B !== null:
    //   starterBestCase = B, starterWorstCase = B
    // If a starter is unlocked and has n > 0 remaining games:
    //   starterBestCase = Math.max(B ?? 0, ceiling ?? 0)
    //   starterWorstCase = floor ?? B ?? 0
    if (isLocked && B !== null) {
      bestCase = B;
      worstCase = B;
    } else if (n === 0 && B !== null) {
      bestCase = B;
      worstCase = B;
    } else if (!isLocked && n > 0) {
      bestCase = Math.max(B ?? 0, evaluation.ceiling ?? 0);
      worstCase = evaluation.floor ?? B ?? 0;
    } else {
      bestCase = 0;
      worstCase = 0;
    }

    userBestCase = round2(userBestCase + bestCase);
    userWorstCase = round2(userWorstCase + worstCase);

    return {
      slotIndex,
      slot,
      player,
      bankedScore: B,
      isLocked,
      remainingGamesCount: n,
      bestCase,
      worstCase,
    };
  });

  const opponentTotal = round2(opponentPointsOverride ?? week.opponentPoints);
  const margin = round2(userTotal - opponentTotal);

  return {
    leg: week.leg,
    userTotal,
    opponentTotal,
    margin,
    startersWithRemainingGames,
    totalStarterRemainingGames,
    userBestCase,
    userWorstCase,
    starterBounds,
  };
}

/**
 * Evaluates all positive Bench Swing swap opportunities per Phase 3 v1.0 §6.
 */
export function evaluateBenchSwings(
  week: WeekRecord,
  players: Player[],
  logs: GameLog[],
  locks: LockRecord[],
): BenchSwingRecommendation[] {
  const playerMap = new Map(players.map((p) => [p.sleeperId, p]));
  const starterRows = adviseWeek(week, players, logs, locks);
  const recommendations: BenchSwingRecommendation[] = [];

  for (const benchId of week.bench) {
    const benchPlayer = playerMap.get(benchId);
    if (!benchPlayer) continue;

    const benchEval = evaluatePlayerForWeek(benchId, week, logs, locks);
    if (benchEval.bankedScore === null) continue;

    const benchValue = benchEval.bankedScore;

    for (const starterRow of starterRows) {
      if (!isEligibleForSlot(benchPlayer.positions, starterRow.slot)) {
        continue;
      }
      const starterBanked = starterRow.evaluation.bankedScore;
      const swing = round2(benchValue - (starterBanked ?? 0));
      if (swing > 0) {
        recommendations.push({
          benchPlayer,
          benchValue,
          benchGameDate: benchEval.bankedGameDate,
          benchOpponent: benchEval.bankedOpponent,
          benchLocked: benchEval.lock !== null,
          benchRemainingGames: benchEval.remainingGamesCount,
          benchRideEV: benchEval.rideEV,
          slotIndex: starterRow.slotIndex,
          slot: starterRow.slot,
          starterPlayer: starterRow.player,
          starterBanked,
          starterLocked: starterRow.evaluation.lock !== null,
          swing,
        });
      }
    }
  }

  recommendations.sort(
    (a, b) =>
      b.swing - a.swing ||
      a.slotIndex - b.slotIndex ||
      a.benchPlayer.name.localeCompare(b.benchPlayer.name),
  );

  return recommendations;
}
