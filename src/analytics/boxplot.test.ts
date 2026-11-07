// Unit tests for Five-Number Summary — spec v1.0 §5.5.

import { describe, expect, it } from "vitest";
import {
  analyzePlayer,
  filterLogsByWindow,
  fiveNumberSummary,
} from "./index.js";
import { loadGameLogs, loadPlayers } from "../data/load.js";

describe("fiveNumberSummary — worked examples (spec §5.5)", () => {
  const allSeededLogs = loadGameLogs("data/game-logs.json");
  const playersFile = loadPlayers("data/players.json");

  it("Example 1: Kessler (2441) All Season (N = 10)", () => {
    const kesslerAnalytics = analyzePlayer("2441", allSeededLogs);
    const totals = kesslerAnalytics.distribution.map((g) => g.total);
    const summary = fiveNumberSummary(totals);
    expect(summary).toEqual({
      n: 10,
      min: 12.75,
      q1: 34.06,
      median: 43.25,
      q3: 45.81,
      max: 62.5,
      iqr: 11.75,
    });
  });

  it("Example 2: Kessler (2441) last-week at asOf = 2026-11-07 (N = 4)", () => {
    const windowedLogs = filterLogsByWindow(allSeededLogs, "last-week", "2026-11-07");
    const kesslerWindowed = analyzePlayer("2441", windowedLogs);
    const totals = kesslerWindowed.distribution.map((g) => g.total);
    const summary = fiveNumberSummary(totals);
    expect(summary).toEqual({
      n: 4,
      min: 38.0,
      q1: 42.31,
      median: 44.88,
      q3: 46.56,
      max: 48.25,
      iqr: 4.25,
    });
  });

  it("Small-N: N = 3 ([10, 20, 30])", () => {
    expect(fiveNumberSummary([30, 10, 20])).toEqual({
      n: 3,
      min: 10.0,
      q1: 15.0,
      median: 20.0,
      q3: 25.0,
      max: 30.0,
      iqr: 10.0,
    });
  });

  it("Small-N: N = 2 ([10, 30])", () => {
    expect(fiveNumberSummary([30, 10])).toEqual({
      n: 2,
      min: 10.0,
      q1: 15.0,
      median: 20.0,
      q3: 25.0,
      max: 30.0,
      iqr: 10.0,
    });
  });

  it("Small-N: N = 1 ([44.50]) — all five numbers equal that game's total and iqr = 0", () => {
    expect(fiveNumberSummary([44.5])).toEqual({
      n: 1,
      min: 44.5,
      q1: 44.5,
      median: 44.5,
      q3: 44.5,
      max: 44.5,
      iqr: 0,
    });
  });

  it("Small-N: N = 0 — returns null", () => {
    expect(fiveNumberSummary([])).toBeNull();
  });

  it("does not mutate the input array", () => {
    const input = [48.25, 38.0, 46.0, 43.75];
    fiveNumberSummary(input);
    expect(input).toEqual([48.25, 38.0, 46.0, 43.75]);
  });

  it("agrees with summarize().median across all 15 seeded players", () => {
    for (const player of playersFile.players) {
      const a = analyzePlayer(player.sleeperId, allSeededLogs);
      const totals = a.distribution.map((g) => g.total);
      const box = fiveNumberSummary(totals);
      if (a.summary.gamesPlayed === 0) {
        expect(box).toBeNull();
      } else {
        expect(box).not.toBeNull();
        expect(box?.median).toBe(a.summary.median);
        expect(box?.min).toBe(a.summary.floor);
        expect(box?.max).toBe(a.summary.ceiling);
      }
    }
  });
});
