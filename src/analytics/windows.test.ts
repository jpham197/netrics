// Unit tests for Time-Window Filtering — spec v1.0 §5.6.

import { describe, expect, it } from "vitest";
import {
  TIME_WINDOWS,
  filterGamesByWindow,
  filterLogsByWindow,
  scoreLogs,
  windowStartDate,
} from "./index.js";
import { loadGameLogs } from "../data/load.js";
import type { GameLog } from "../data/types.js";

function makeLog(date: string, pts = 20): GameLog {
  return {
    sleeperId: "2441",
    date,
    opponent: "OPP",
    pts,
    reb: 5,
    ast: 2,
    stl: 1,
    blk: 1,
    tov: 1,
    source: "test",
  };
}

describe("TIME_WINDOWS and windowStartDate (spec §5.6)", () => {
  it("defines the 4 canonical windows in order", () => {
    expect(TIME_WINDOWS).toEqual([
      { id: "last-week", label: "Last week", days: 7 },
      { id: "last-3-weeks", label: "Last 3 weeks", days: 21 },
      { id: "last-month", label: "Last month", days: 30 },
      { id: "all", label: "All season", days: null },
    ]);
  });

  it("computes inclusive start dates anchored at asOf = 2026-11-07", () => {
    expect(windowStartDate("2026-11-07", 7)).toBe("2026-11-01");
    expect(windowStartDate("2026-11-07", 21)).toBe("2026-10-18");
    expect(windowStartDate("2026-11-07", 30)).toBe("2026-10-09");
    expect(windowStartDate("2026-11-07", 1)).toBe("2026-11-07");
  });
});

describe("filterLogsByWindow and filterGamesByWindow", () => {
  const sampleLogs: GameLog[] = [
    makeLog("2026-10-31", 10), // 1 day before last-week start (2026-11-01)
    makeLog("2026-11-01", 15), // exact start boundary
    makeLog("2026-11-04", 20), // middle of window
    makeLog("2026-11-07", 25), // exact asOf boundary
    makeLog("2026-11-08", 30), // 1 day after asOf
  ];

  it("includes exact startDate and asOf boundaries and excludes out-of-window logs", () => {
    const filtered = filterLogsByWindow(sampleLogs, "last-week", "2026-11-07");
    expect(filtered.map((l) => l.date)).toEqual(["2026-11-01", "2026-11-04", "2026-11-07"]);
  });

  it("returns the input array reference unchanged when window === 'all'", () => {
    const filtered = filterLogsByWindow(sampleLogs, "all", "2026-11-07");
    expect(filtered).toBe(sampleLogs);
  });

  it("filters ScoredGame[] with identical boundary rules", () => {
    const scored = scoreLogs(sampleLogs);
    const filtered = filterGamesByWindow(scored, "last-week", "2026-11-07");
    expect(filtered.map((g) => g.log.date)).toEqual(["2026-11-01", "2026-11-04", "2026-11-07"]);
    expect(filterGamesByWindow(scored, "all", "2026-11-07")).toBe(scored);
  });

  it("filters real seeded Kessler logs (2441) for last-week at 2026-11-07 to 4 games", () => {
    const allSeededLogs = loadGameLogs("data/game-logs.json").filter(
      (l) => l.sleeperId === "2441" && l.date <= "2026-11-06",
    );
    const lastWeek = filterLogsByWindow(allSeededLogs, "last-week", "2026-11-07");

    expect(lastWeek.map((l) => l.date).sort()).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
    ]);
  });
});
