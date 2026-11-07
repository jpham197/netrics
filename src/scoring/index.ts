// Netrics scoring engine — pure, deterministic, no UI, no network.
// Spec: docs/design/NETRICS-DESIGN-v1.0.md §3 (FROZEN).
// This is the SOLE place fantasy points are calculated.

export interface GameLogInput {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  tf?: number;
  ff?: number;
}

export interface ScoreBreakdown {
  /** pts * 1.0 */
  scoring: number;
  /** reb * 1.25 */
  rebounds: number;
  /** ast * 1.5 */
  playmaking: number;
  /** (stl + blk) * 3.0 */
  stocks: number;
  /** dd(2) + td(3) + pts40(1) + pts50(1) + ast15(1) + reb20(1) */
  bonuses: number;
  /** -(tov * 1.0 + tf * 2.0 + ff * 2.0), always <= 0 */
  penalties: number;
}

export interface FantasyScoreResult {
  total: number;
  breakdown: ScoreBreakdown;
  isDoubleDouble: boolean;
  isTripleDouble: boolean;
}

/** Round to 2 decimals. Sleeper totals land on .00 / .25 / .50 / .75. Normalises -0 to 0. */
export function round2(n: number): number {
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return r === 0 ? 0 : r;
}

/**
 * Count how many of the 5 positive categories are >= 10.
 * Turnovers never count (a 10-tov game is not a double-double).
 */
export function qualifyingCategoryCount(g: GameLogInput): number {
  return [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;
}

export function fantasyPoints(g: GameLogInput): FantasyScoreResult {
  const tf = g.tf ?? 0;
  const ff = g.ff ?? 0;
  const count = qualifyingCategoryCount(g);
  const isDoubleDouble = count >= 2;
  // Triple-double stacks with double-double: +2 (DD) + 3 (TD) = +5 total.
  const isTripleDouble = count >= 3;

  const breakdown: ScoreBreakdown = {
    scoring: round2(g.pts * 1.0),
    rebounds: round2(g.reb * 1.25),
    playmaking: round2(g.ast * 1.5),
    stocks: round2((g.stl + g.blk) * 3.0),
    bonuses:
      (isDoubleDouble ? 2 : 0) +
      (isTripleDouble ? 3 : 0) +
      (g.pts >= 40 ? 1 : 0) +
      (g.pts >= 50 ? 1 : 0) +
      (g.ast >= 15 ? 1 : 0) +
      (g.reb >= 20 ? 1 : 0),
    penalties: round2(-(g.tov * 1.0 + tf * 2.0 + ff * 2.0)),
  };

  const total = round2(
    breakdown.scoring +
      breakdown.rebounds +
      breakdown.playmaking +
      breakdown.stocks +
      breakdown.bonuses +
      breakdown.penalties,
  );

  return { total, breakdown, isDoubleDouble, isTripleDouble };
}
