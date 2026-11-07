// Netrics per-player analytics — spec v1.0 §5 (FROZEN).
// All metrics are derived from a player's scored game logs.
// This module NEVER reads GameLog.expectedTotal (validation-only).

import { fantasyPoints, round2, type FantasyScoreResult } from "../scoring/index.js";
import type { GameLog } from "../data/types.js";

export interface ScoredGame {
  log: GameLog;
  score: FantasyScoreResult;
  total: number;
  /** True for the Top 3 games by total. */
  isSpike: boolean;
  /**
   * Primary driver for Top 3 games: the largest non-scoring contribution
   * among rebounds / playmaking / stocks / bonuses; "scoring" if no
   * non-scoring part is positive. Undefined for non-spike games.
   */
  primaryDriver?: "rebounds" | "playmaking" | "stocks" | "bonuses" | "scoring";
}

export type DistributionSort = "score" | "date";

export interface PlayerSummary {
  gamesPlayed: number;
  ceiling: number | null;
  floor: number | null;
  /** Middle value of sorted totals; even GP = average of two middle, round2. */
  median: number | null;
  lastGame: ScoredGame | null;
  /** Arithmetic average, round2. Labelled "Mean (ref only)" in UI — never a decision target. */
  mean: number | null;
}

export interface BeatingGame {
  log: GameLog;
  total: number;
  /** round2(total - target) */
  margin: number;
}

export interface TargetEvaluation {
  target: number;
  beatCount: number;
  gamesPlayed: number;
  /** beatCount / gamesPlayed, 0 when gamesPlayed is 0. */
  beatRate: number;
  /** Games with total > target (strict), sorted high -> low. */
  beatingGames: BeatingGame[];
  maxUpside: number;
  maxDownside: number;
}

export interface PlayerAnalytics {
  playerId: string;
  /** Sorted high -> low by total (default view). */
  distribution: ScoredGame[];
  /** Same games sorted oldest -> newest. */
  chronological: ScoredGame[];
  summary: PlayerSummary;
}

function primaryDriverFor(score: FantasyScoreResult): "rebounds" | "playmaking" | "stocks" | "bonuses" | "scoring" {
  const b = score.breakdown;
  const parts = [
    ["rebounds", b.rebounds],
    ["playmaking", b.playmaking],
    ["stocks", b.stocks],
    ["bonuses", b.bonuses],
  ] as const;
  let best: ScoredGame["primaryDriver"] = "scoring";
  let bestValue = 0;
  for (const [name, value] of parts) {
    if (value > bestValue) {
      bestValue = value;
      best = name;
    }
  }
  return best;
}

/** Score every log with the pure engine. Does not read expectedTotal. */
export function scoreLogs(logs: GameLog[]): ScoredGame[] {
  const scored: ScoredGame[] = logs.map((log) => {
    const score = fantasyPoints(log);
    return { log, score, total: score.total, isSpike: false };
  });
  // Top 3 by total are spikes. Ties at the cut: all games with total >=
  // the 3rd-highest total are flagged, so a tie does not arbitrarily drop one.
  if (scored.length > 0) {
    const sortedTotals = [...scored].map((s) => s.total).sort((a, b) => b - a);
    const cutoff = sortedTotals[Math.min(2, sortedTotals.length - 1)];
    for (const s of scored) {
      if (s.total >= (cutoff as number)) {
        s.isSpike = true;
        s.primaryDriver = primaryDriverFor(s.score);
      }
    }
  }
  return scored;
}

export function sortDistribution(scored: ScoredGame[], sort: DistributionSort): ScoredGame[] {
  const copy = [...scored];
  if (sort === "score") {
    copy.sort((a, b) => b.total - a.total || a.log.date.localeCompare(b.log.date));
  } else {
    copy.sort((a, b) => a.log.date.localeCompare(b.log.date) || b.total - a.total);
  }
  return copy;
}

export function summarize(scored: ScoredGame[]): PlayerSummary {
  if (scored.length === 0) {
    return { gamesPlayed: 0, ceiling: null, floor: null, median: null, lastGame: null, mean: null };
  }
  const totals = scored.map((s) => s.total).sort((a, b) => a - b);
  const ceiling = totals[totals.length - 1] as number;
  const floor = totals[0] as number;
  const mid = Math.floor(totals.length / 2);
  const median =
    totals.length % 2 === 1
      ? (totals[mid] as number)
      : round2(((totals[mid - 1] as number) + (totals[mid] as number)) / 2);
  const mean = round2(totals.reduce((a, b) => a + b, 0) / totals.length);
  const lastGame = [...scored].sort((a, b) => b.log.date.localeCompare(a.log.date))[0] as ScoredGame;
  return { gamesPlayed: scored.length, ceiling, floor, median, lastGame, mean };
}

/**
 * Target Score Evaluation, spec v1.0 §5.3.
 * Beat = total STRICTLY greater than target. Equality does not beat.
 */
export function evaluateTarget(scored: ScoredGame[], target: number): TargetEvaluation {
  const summary = summarize(scored);
  const beatingGames: BeatingGame[] = scored
    .filter((s) => s.total > target)
    .map((s) => ({ log: s.log, total: s.total, margin: round2(s.total - target) }))
    .sort((a, b) => b.total - a.total);
  return {
    target,
    beatCount: beatingGames.length,
    gamesPlayed: scored.length,
    beatRate: scored.length > 0 ? beatingGames.length / scored.length : 0,
    beatingGames,
    maxUpside: summary.ceiling === null ? 0 : Math.max(0, round2(summary.ceiling - target)),
    maxDownside: summary.floor === null ? 0 : Math.max(0, round2(target - summary.floor)),
  };
}

/** Full per-player analysis: distribution + summary. Target evaluation is separate. */
export function analyzePlayer(sleeperId: string, logs: GameLog[]): PlayerAnalytics {
  const scored = scoreLogs(logs);
  return {
    playerId: sleeperId,
    distribution: sortDistribution(scored, "score"),
    chronological: sortDistribution(scored, "date"),
    summary: summarize(scored),
  };
}
