// Analytics tests — spec v1.0 §5.
// Kessler 9-game fixture below is TOTALS-ONLY (not real game lines):
// the totals are the documented 9-game distribution from v1.0/memory
// (42.75, 62.50, 12.75, 28.00, 32.75, 45.25, 48.25, 43.75, 46.00).
// It tests beat-rate math only. It is NOT seed data.

import { describe, expect, it } from "vitest";
import { analyzePlayer, evaluateTarget, scoreLogs, type ScoredGame } from "./index.js";
import { fantasyPoints } from "../scoring/index.js";
import type { GameLog } from "../data/types.js";

function makeLog(over: Partial<GameLog> & { sleeperId: string; date: string }): GameLog {
  return { opponent: "OPP", pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, source: "test", ...over };
}

/** Totals-only ScoredGame fixture for beat-rate math. See header comment. */
function totalsFixture(totals: number[]): ScoredGame[] {
  return totals.map((total, i) => ({
    log: makeLog({ sleeperId: "2441", date: `2026-10-${String(20 + i).padStart(2, "0")}` }),
    score: {
      total,
      breakdown: { scoring: total, rebounds: 0, playmaking: 0, stocks: 0, bonuses: 0, penalties: 0 },
      isDoubleDouble: false,
      isTripleDouble: false,
    },
    total,
    isSpike: false,
  }));
}

describe("Kessler 9-game distribution — beat-rate vs 46.00", () => {
  const totals = [42.75, 62.5, 12.75, 28.0, 32.75, 45.25, 48.25, 43.75, 46.0];
  const ev = evaluateTarget(totalsFixture(totals), 46.0);

  it("beat-rate is 2/9 (strict >: the 46.00 game itself does not beat 46.00)", () => {
    expect(ev.beatCount).toBe(2);
    expect(ev.gamesPlayed).toBe(9);
    expect(ev.beatRate).toBeCloseTo(2 / 9);
  });

  it("beating games are 62.50 (+16.50) and 48.25 (+2.25), high -> low", () => {
    expect(ev.beatingGames.map((g) => g.total)).toEqual([62.5, 48.25]);
    expect(ev.beatingGames.map((g) => g.margin)).toEqual([16.5, 2.25]);
  });

  it("maxUpside = ceiling - target, maxDownside = target - floor", () => {
    expect(ev.maxUpside).toBe(16.5);
    expect(ev.maxDownside).toBe(33.25);
  });
});

describe("analyzePlayer — real seeded lines", () => {
  const kesslerLogs: GameLog[] = [
    makeLog({ sleeperId: "2441", date: "2026-10-23", opponent: "LAC", pts: 22, reb: 8, ast: 3, stl: 3, blk: 6, tov: 1, source: "seed" }),
    makeLog({ sleeperId: "2441", date: "2026-11-01", opponent: "TOR", pts: 16, reb: 15, ast: 1, stl: 1, blk: 3, tov: 2, source: "seed" }),
    makeLog({ sleeperId: "2441", date: "2026-11-04", opponent: "@SAC", pts: 15, reb: 8, ast: 0, stl: 3, blk: 4, tov: 0, source: "seed" }),
  ];

  it("distribution is sorted high -> low, chronological is oldest -> newest", () => {
    const a = analyzePlayer("2441", kesslerLogs);
    expect(a.distribution.map((s) => s.total)).toEqual([62.5, 48.25, 46]);
    expect(a.chronological.map((s) => s.log.date)).toEqual(["2026-10-23", "2026-11-01", "2026-11-04"]);
  });

  it("summary: ceiling / floor / median / mean / lastGame", () => {
    const a = analyzePlayer("2441", kesslerLogs);
    expect(a.summary.gamesPlayed).toBe(3);
    expect(a.summary.ceiling).toBe(62.5);
    expect(a.summary.floor).toBe(46);
    expect(a.summary.median).toBe(48.25);
    expect(a.summary.mean).toBe(52.25);
    expect(a.summary.lastGame?.log.date).toBe("2026-11-04");
    expect(a.summary.lastGame?.total).toBe(46);
  });

  it("median with even GP is the average of the two middle values", () => {
    const logs = kesslerLogs.slice(0, 2); // 62.50, 48.25
    expect(analyzePlayer("2441", logs).summary.median).toBe(55.38); // (62.50+48.25)/2 = 55.375 -> 55.38
  });

  it("Top 3 games are flagged isSpike with a primary driver; stocks drive Kessler's ceiling game", () => {
    const a = analyzePlayer("2441", kesslerLogs);
    expect(a.distribution.every((s) => s.isSpike)).toBe(true); // only 3 games, all Top 3
    const top = a.distribution[0] as ScoredGame;
    expect(top.total).toBe(62.5);
    // 62.50 game: stocks 27.00 is the largest non-scoring part
    expect(top.primaryDriver).toBe("stocks");
  });

  it("empty log list gives null summary stats, not a crash", () => {
    const a = analyzePlayer("2441", []);
    expect(a.summary).toEqual({ gamesPlayed: 0, ceiling: null, floor: null, median: null, lastGame: null, mean: null });
    expect(evaluateTarget([], 40).beatRate).toBe(0);
  });
});

describe("analytics never reads expectedTotal", () => {
  it("a wrong expectedTotal does not change the computed total", () => {
    const bad = makeLog({
      sleeperId: "2181",
      date: "2026-11-06",
      opponent: "LAL",
      pts: 22, reb: 9, ast: 11, stl: 2, blk: 0, tov: 8,
      source: "seed",
      expectedTotal: 999,
    });
    const [scored] = scoreLogs([bad]);
    expect(scored?.total).toBe(49.75);
    expect(fantasyPoints(bad).total).toBe(49.75);
  });
});
