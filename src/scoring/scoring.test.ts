// Scoring tests — spec v1.0 §3 worked examples + edge cases.
// All worked-example lines are real, sourced lines from v1.0 §3.

import { describe, expect, it } from "vitest";
import { fantasyPoints, round2, type GameLogInput } from "./index.js";

function log(p: Partial<GameLogInput> & { pts: number }): GameLogInput {
  return { reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, ...p };
}

describe("fantasyPoints — v1.0 §3 worked examples", () => {
  it("Avdija 2026-11-06 vs LAL = 49.75 (DD: pts, ast)", () => {
    const r = fantasyPoints(log({ pts: 22, reb: 9, ast: 11, stl: 2, blk: 0, tov: 8 }));
    expect(r.total).toBe(49.75);
    expect(r.isDoubleDouble).toBe(true);
    expect(r.isTripleDouble).toBe(false);
    expect(r.breakdown).toEqual({ scoring: 22, rebounds: 11.25, playmaking: 16.5, stocks: 6, bonuses: 2, penalties: -8 });
  });

  it("Markkanen 2026-11-04 @ NOP = 47.50 (DD: pts, reb)", () => {
    const r = fantasyPoints(log({ pts: 21, reb: 10, ast: 4, stl: 1, blk: 2, tov: 3 }));
    expect(r.total).toBe(47.5);
    expect(r.isDoubleDouble).toBe(true);
  });

  it("Kessler 2026-11-04 @ SAC = 46.00 (no DD)", () => {
    const r = fantasyPoints(log({ pts: 15, reb: 8, ast: 0, stl: 3, blk: 4, tov: 0 }));
    expect(r.total).toBe(46);
    expect(r.isDoubleDouble).toBe(false);
    expect(r.breakdown.stocks).toBe(21);
  });

  it("Fears 2026-11-06 vs MIN = 41.75, tov=2 verified in box score", () => {
    const r = fantasyPoints(log({ pts: 24, reb: 5, ast: 5, stl: 2, blk: 0, tov: 2 }));
    expect(r.total).toBe(41.75);
  });

  it("McCain 2026-11-06 @ MEM = 41.25", () => {
    const r = fantasyPoints(log({ pts: 21, reb: 5, ast: 0, stl: 4, blk: 1, tov: 1 }));
    expect(r.total).toBe(41.25);
    expect(r.breakdown.stocks).toBe(15);
  });
});

describe("fantasyPoints — triple-double stacking", () => {
  it("TD stacks DD+TD = +5.0; tov never counts toward DD/TD", () => {
    // SYNTHETIC FIXTURE — not a real game line, not seed data.
    // No verified 2026-27 Cade Cunningham / Sabonis triple-double line was
    // found in this pass (closest real Cade line: 26/7/11 vs PHI, Nov 4).
    // This fixture tests only the stacking rule.
    const r = fantasyPoints(log({ pts: 24, reb: 12, ast: 11, stl: 1, blk: 0, tov: 4 }));
    expect(r.isDoubleDouble).toBe(true);
    expect(r.isTripleDouble).toBe(true);
    expect(r.breakdown.bonuses).toBe(5);
    // 24 + 15 + 16.5 + 3 + 5 - 4 = 59.5
    expect(r.total).toBe(59.5);
  });

  it("10 turnovers alone is not a double-double", () => {
    const r = fantasyPoints(log({ pts: 9, reb: 9, ast: 9, stl: 0, blk: 0, tov: 10 }));
    expect(r.isDoubleDouble).toBe(false);
    expect(r.isTripleDouble).toBe(false);
    expect(r.breakdown.bonuses).toBe(0);
  });
});

describe("fantasyPoints — milestone bonuses and edge cases", () => {
  it("50-point game stacks 40+ and 50+ bonuses (+2)", () => {
    const r = fantasyPoints(log({ pts: 50, reb: 5, ast: 5, stl: 0, blk: 0, tov: 2 }));
    expect(r.breakdown.bonuses).toBe(2);
    // 50 + 6.25 + 7.5 + 0 + 2 - 2 = 63.75
    expect(r.total).toBe(63.75);
  });

  it("40-point game gets only the 40+ bonus (+1)", () => {
    const r = fantasyPoints(log({ pts: 40, reb: 5, ast: 5, stl: 0, blk: 0, tov: 0 }));
    expect(r.breakdown.bonuses).toBe(1);
  });

  it("20-rebound game gets the 20+ rebound bonus; 15-assist game gets the 15+ assist bonus", () => {
    expect(fantasyPoints(log({ pts: 10, reb: 20, ast: 0 })).breakdown.bonuses).toBe(3); // DD (pts+reb) + reb20
    expect(fantasyPoints(log({ pts: 10, reb: 5, ast: 15 })).breakdown.bonuses).toBe(3); // DD (pts+ast) + ast15
  });

  it("0-stat game scores 0", () => {
    const r = fantasyPoints(log({ pts: 0 }));
    expect(r.total).toBe(0);
    expect(r.breakdown).toEqual({ scoring: 0, rebounds: 0, playmaking: 0, stocks: 0, bonuses: 0, penalties: 0 });
  });

  it("high-turnover game can go negative", () => {
    const r = fantasyPoints(log({ pts: 5, reb: 2, ast: 1, stl: 0, blk: 0, tov: 12 }));
    // 5 + 2.5 + 1.5 - 12 = -3
    expect(r.total).toBe(-3);
  });

  it("technical / flagrant fouls cost 2 each", () => {
    const r = fantasyPoints(log({ pts: 10, tf: 1, ff: 1 }));
    expect(r.breakdown.penalties).toBe(-4);
    expect(r.total).toBe(6);
  });

  it("6-part breakdown always sums exactly to total", () => {
    const cases: GameLogInput[] = [
      log({ pts: 22, reb: 9, ast: 11, stl: 2, blk: 0, tov: 8 }),
      log({ pts: 50, reb: 21, ast: 16, stl: 2, blk: 2, tov: 5, tf: 1 }),
      log({ pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0 }),
      log({ pts: 33, reb: 5, ast: 7, stl: 5, blk: 0, tov: 3 }),
    ];
    for (const c of cases) {
      const r = fantasyPoints(c);
      const b = r.breakdown;
      expect(b.scoring + b.rebounds + b.playmaking + b.stocks + b.bonuses + b.penalties).toBe(r.total);
    }
  });

  it("round2 rounds symmetrically for positive and negative values and normalizes -0", () => {
    expect(round2(55.375)).toBe(55.38);
    expect(round2(-55.375)).toBe(-55.38);
    expect(round2(-0)).toBe(0);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });
});

