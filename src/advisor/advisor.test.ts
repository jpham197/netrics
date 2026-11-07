// Unit tests for src/advisor/index.ts — Phase 3 v1.0 §4, §5, §6.

import { describe, expect, it } from "vitest";
import { analyzePlayer, scoreLogs } from "../analytics/index.js";
import { loadAll } from "../data/load.js";
import type { GameLog, LockRecord, WeekRecord } from "../data/types.js";
import {
  adviseWeek,
  evaluateBenchSwings,
  evaluateLockDecision,
  evaluateMatchup,
  evaluatePlayerForWeek,
  isEligibleForSlot,
} from "./index.js";

function makeLog(over: Partial<GameLog> & { sleeperId: string; date: string }): GameLog {
  return {
    opponent: "OPP",
    pts: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    source: "test",
    ...over,
  };
}

const LEG3_NOV7_REMAINING_GAMES: Record<string, string[]> = {
  "2267": ["2026-11-08"],
  "4737": ["2026-11-08"],
  "4750": ["2026-11-08"],
  "2714": ["2026-11-07"],
  "2181": ["2026-11-07"],
  "1752": ["2026-11-08"],
  "1739": ["2026-11-08"],
  "2441": ["2026-11-08"],
  "2713": ["2026-11-07"],
  "1074": ["2026-11-08"],
  "2131": ["2026-11-08"],
  "1998": [],
  "2583": ["2026-11-08"],
  "4742": ["2026-11-07", "2026-11-08"],
  "2456": [],
};

function makeLeg3Snapshot(weeks: WeekRecord[]): WeekRecord {
  const base = weeks.find((w) => w.leg === 3) ?? (weeks[0] as WeekRecord);
  return {
    ...base,
    remainingGames: { ...LEG3_NOV7_REMAINING_GAMES },
  };
}

describe("Lock Advisor — §4.4 Required Worked Examples", () => {
  const { logs: allLogs, weeks: realWeeks, locks: realLocks } = loadAll();
  const realLogs = allLogs.filter((l) => l.date <= "2026-11-06");
  const leg3 = makeLeg3Snapshot(realWeeks.weeks);

  it("Example 1: Kessler (2441), Leg 3, Sat Nov 7 — B = 38.00, n = 1 -> meanUpside = 10.08, meanShortfall = 10.13, rideEV = +2.00, RIDE", () => {
    const ev = evaluatePlayerForWeek("2441", leg3, realLogs, realLocks.locks);
    expect(ev.status).toBe("DECISION");
    expect(ev.bankedScore).toBe(38.0);
    expect(ev.bankedGameDate).toBe("2026-11-06");
    expect(ev.bankedOpponent).toBe("POR");
    expect(ev.remainingGamesCount).toBe(1);
    expect(ev.gamesPlayed).toBe(10);
    expect(ev.beatCount).toBe(6);
    expect(ev.nonBeatCount).toBe(4); // includes the 38.00 tie game with 0.00 shortfall
    expect(ev.beatRate).toBeCloseTo(0.6, 5);
    expect(ev.pAnyBeat).toBeCloseTo(0.6, 5);
    expect(ev.meanUpside).toBe(10.08);
    expect(ev.meanShortfall).toBe(10.13);
    expect(ev.rideEV).toBe(2.0);
    expect(ev.recommendation).toBe("RIDE");
    expect(ev.nearCeiling).toBe(false);
    expect(ev.maxGainToCeiling).toBe(24.5); // 62.50 - 38.00
  });

  it("Example 2: Avdija (2181), Leg 3 before Nov 6 game — B = 46.75 (after Nov 4), n = 1 -> meanUpside = 2.00, meanShortfall = 5.92, rideEV = -4.79, LOCK", () => {
    // Filter Avdija's logs to games through Nov 4 (7 games)
    const avdijaLogsThroughNov4 = realLogs.filter(
      (l) => l.sleeperId === "2181" && l.date <= "2026-11-04",
    );
    const analytics = analyzePlayer("2181", avdijaLogsThroughNov4);
    const legGames = analytics.distribution.filter(
      (g) => g.log.date >= "2026-11-02" && g.log.date <= "2026-11-08",
    );

    const ev = evaluateLockDecision({
      sleeperId: "2181",
      distribution: analytics.distribution,
      legGames,
      lock: null,
      remainingGameDates: ["2026-11-06"],
    });

    expect(ev.status).toBe("DECISION");
    expect(ev.gamesPlayed).toBe(7);
    expect(ev.bankedScore).toBe(46.75);
    expect(ev.beatCount).toBe(1);
    expect(ev.nonBeatCount).toBe(6);
    expect(ev.beatRate).toBeCloseTo(1 / 7, 5);
    expect(ev.pAnyBeat).toBeCloseTo(1 / 7, 5);
    expect(ev.meanUpside).toBe(2.0);
    expect(ev.meanShortfall).toBe(5.92);
    // Computed from unrounded intermediates: (1/7)*2.00 - (6/7)*(35.50/6) = -33.50/7 = -4.7857... -> -4.79
    expect(ev.rideEV).toBe(-4.79);
    expect(ev.recommendation).toBe("LOCK");
    // Ceiling through Nov 4 was 48.75, so 46.75 >= 48.75 - 2.00 -> nearCeiling is true!
    expect(ev.nearCeiling).toBe(true);
    expect(ev.maxGainToCeiling).toBe(2.0);
  });
});

describe("Lock Advisor — Multi-game sequential stopping, LEAN_RIDE, and edge states", () => {
  it("computes pAnyBeat = 1 - (1 - beatRate)^n for n >= 2 and recommends LEAN_RIDE when rideEV > 0 and pAnyBeat < 0.5", () => {
    // 5 games: four at 20.00, one huge spike at 70.00.
    // Banked game in leg is 20.00.
    // beatRate = 1/5 = 0.20.
    // For n = 2 remaining games: pAnyBeat = 1 - 0.8^2 = 0.36 (< 0.5).
    // meanUpsideRaw = 50.00 (70 - 20); meanShortfallRaw = 0.00 (four 20.00 ties).
    // rideEV = 0.36 * 50 - 0.64 * 0 = +18.00 > 0, pAnyBeat = 0.36 < 0.5 -> LEAN_RIDE.
    const logs: GameLog[] = [
      makeLog({ sleeperId: "p1", date: "2026-10-21", pts: 20 }),
      makeLog({ sleeperId: "p1", date: "2026-10-23", pts: 20 }),
      makeLog({ sleeperId: "p1", date: "2026-10-25", pts: 20 }),
      makeLog({ sleeperId: "p1", date: "2026-10-27", pts: 68 }), // 68 pts -> +2 bonus (40p+50p) = 70.00
      makeLog({ sleeperId: "p1", date: "2026-11-02", pts: 20 }),
    ];
    const scored = scoreLogs(logs);
    const legGames = scored.filter((g) => g.log.date >= "2026-11-02");

    const ev = evaluateLockDecision({
      sleeperId: "p1",
      distribution: scored,
      legGames,
      lock: null,
      remainingGameDates: ["2026-11-07", "2026-11-08"],
    });

    expect(ev.status).toBe("DECISION");
    expect(ev.beatRate).toBeCloseTo(0.2, 5);
    expect(ev.pAnyBeat).toBeCloseTo(0.36, 5);
    expect(ev.rideEV).toBe(18.0);
    expect(ev.recommendation).toBe("LEAN_RIDE");
  });

  it("handles LOCKED status and computes lockGainVsLatest accurately", () => {
    const { logs: allLogs, weeks: realWeeks, locks: realLocks } = loadAll();
    const realLogs = allLogs.filter((l) => l.date <= "2026-11-06");
    const leg3 = makeLeg3Snapshot(realWeeks.weeks);

    // Markkanen (1752) locked Nov 4 at 47.50; his latest game on Nov 6 scored 33.50 -> lockGainVsLatest = +14.00
    const markkanenEv = evaluatePlayerForWeek("1752", leg3, realLogs, realLocks.locks);
    expect(markkanenEv.status).toBe("LOCKED");
    expect(markkanenEv.recommendation).toBeNull();
    expect(markkanenEv.bankedScore).toBe(47.5);
    expect(markkanenEv.bankedGameDate).toBe("2026-11-04");
    expect(markkanenEv.latestLegGame?.total).toBe(33.5);
    expect(markkanenEv.lockGainVsLatest).toBe(14.0);
    expect(markkanenEv.pAnyBeat).toBe(0);
    expect(markkanenEv.rideEV).toBe(0);

    // Avdija (2181) locked Nov 4 at 46.75; his latest game on Nov 6 scored 49.75 -> lockGainVsLatest = -3.00
    const avdijaEv = evaluatePlayerForWeek("2181", leg3, realLogs, realLocks.locks);
    expect(avdijaEv.status).toBe("LOCKED");
    expect(avdijaEv.bankedScore).toBe(46.75);
    expect(avdijaEv.latestLegGame?.total).toBe(49.75);
    expect(avdijaEv.lockGainVsLatest).toBe(-3.0);
  });

  it("handles NO_GAMES_LEFT and NO_BANKED_SCORE statuses", () => {
    const { logs: allLogs, weeks: realWeeks } = loadAll();
    const realLogs = allLogs.filter((l) => l.date <= "2026-11-06");
    const leg3 = makeLeg3Snapshot(realWeeks.weeks);

    // Keegan Murray (2456) has 0 games -> NO_BANKED_SCORE
    const murrayEv = evaluatePlayerForWeek("2456", leg3, realLogs, []);
    expect(murrayEv.status).toBe("NO_BANKED_SCORE");
    expect(murrayEv.recommendation).toBeNull();
    expect(murrayEv.bankedScore).toBeNull();
    expect(murrayEv.rideEV).toBe(0);

    // Unlocked starter with 0 remaining games -> NO_GAMES_LEFT
    const noGamesLeftWeek: WeekRecord = {
      ...leg3,
      remainingGames: { ...leg3.remainingGames, "2441": [] },
    };
    const kesslerDoneEv = evaluatePlayerForWeek("2441", noGamesLeftWeek, realLogs, []);
    expect(kesslerDoneEv.status).toBe("NO_GAMES_LEFT");
    expect(kesslerDoneEv.recommendation).toBeNull();
    expect(kesslerDoneEv.bankedScore).toBe(38.0);
    expect(kesslerDoneEv.rideEV).toBe(0);
    expect(kesslerDoneEv.pAnyBeat).toBe(0);
  });
});

describe("Matchup & Bench Swing — §5 and §6 with real Leg 3 seed data", () => {
  const { players: realPlayers, logs: allLogs, weeks: realWeeks, locks: realLocks } = loadAll();
  const realLogs = allLogs.filter((l) => l.date <= "2026-11-06");
  const leg3 = makeLeg3Snapshot(realWeeks.weeks);


  it("reconciles Leg 3 userTotal to 407.25 vs opponent 317.25 (margin +90.00)", () => {
    const matchup = evaluateMatchup(leg3, realPlayers.players, realLogs, realLocks.locks);
    expect(matchup.userTotal).toBe(407.25);
    expect(matchup.opponentTotal).toBe(317.25);
    expect(matchup.margin).toBe(90.0);
    expect(matchup.startersWithRemainingGames).toBe(9);
    expect(matchup.totalStarterRemainingGames).toBe(9);
    expect(matchup.unlockedStartersWithRemainingGames).toBe(5);
    expect(matchup.unlockedStarterRemainingGames).toBe(5);
  });

  it("computes starter best/worst-case bounds respecting locked starters (Markkanen locked at 47.50 has worstCase = 47.50, never his 2.00 floor)", () => {
    const matchup = evaluateMatchup(leg3, realPlayers.players, realLogs, realLocks.locks);
    const markkanenBound = matchup.starterBounds.find((b) => b.player.sleeperId === "1752");
    expect(markkanenBound).toBeDefined();
    expect(markkanenBound?.isLocked).toBe(true);
    expect(markkanenBound?.bankedScore).toBe(47.5);
    expect(markkanenBound?.bestCase).toBe(47.5);
    expect(markkanenBound?.worstCase).toBe(47.5);

    // Unlocked Kessler (2441) with n = 1 remaining game has bestCase = max(38.00, 62.50) = 62.50 and worstCase = floor = 12.75
    const kesslerBound = matchup.starterBounds.find((b) => b.player.sleeperId === "2441");
    expect(kesslerBound?.isLocked).toBe(false);
    expect(kesslerBound?.bestCase).toBe(62.5);
    expect(kesslerBound?.worstCase).toBe(12.75);

    // Unlocked starter with n = 0 remaining games also has bestCase = banked and worstCase = banked
    const noGamesWeek: WeekRecord = {
      ...leg3,
      remainingGames: { ...leg3.remainingGames, "2441": [] },
    };
    const matchupNoGames = evaluateMatchup(noGamesWeek, realPlayers.players, realLogs, realLocks.locks);
    const kesslerDoneBound = matchupNoGames.starterBounds.find((b) => b.player.sleeperId === "2441");
    expect(kesslerDoneBound?.bestCase).toBe(38.0);
    expect(kesslerDoneBound?.worstCase).toBe(38.0);
  });

  it("supports opponentPointsOverride in evaluateMatchup", () => {
    const matchup = evaluateMatchup(leg3, realPlayers.players, realLogs, realLocks.locks, 350.0);
    expect(matchup.opponentTotal).toBe(350.0);
    expect(matchup.margin).toBe(57.25);
  });

  it("checks slot eligibility rules accurately", () => {
    expect(isEligibleForSlot(["SF"], "SF")).toBe(true);
    expect(isEligibleForSlot(["SF"], "F")).toBe(true);
    expect(isEligibleForSlot(["SF"], "UTIL")).toBe(true);
    expect(isEligibleForSlot(["SF"], "SG")).toBe(false);
    expect(isEligibleForSlot(["SF"], "G")).toBe(false);
    expect(isEligibleForSlot(["PG"], "G")).toBe(true);
    expect(isEligibleForSlot(["SG"], "G")).toBe(true);
    expect(isEligibleForSlot(["PF"], "F")).toBe(true);
    expect(isEligibleForSlot(["C"], "F")).toBe(false);
    expect(isEligibleForSlot(["C"], "UTIL")).toBe(true);
  });

  it("computes Bench Swing recommendations: Paul George (42.25, SF) beats Kessler (38.00, UTIL, +4.25) and McCain (41.25, UTIL, +1.00), and does NOT qualify for SG", () => {
    const swings = evaluateBenchSwings(leg3, realPlayers.players, realLogs, realLocks.locks);
    // Paul George (1074, SF) is locked on bench at 42.25.
    // Eligible slots for SF:
    // - Slot 3 (SF): Kyshawn George (57.00) -> swing -14.75 (not > 0)
    // - Slot 5 (F): Lauri Markkanen (47.50) -> swing -5.25 (not > 0)
    // - Slot 7 (UTIL): Walker Kessler (38.00) -> swing +4.25
    // - Slot 8 (UTIL): Jared McCain (41.25) -> swing +1.00
    // Slot 1 (SG): VJ Edgecombe (37.75) -> PG13 is SF, so ineligible for SG!
    expect(swings).toHaveLength(2);
    expect(swings[0]?.benchPlayer.sleeperId).toBe("1074");
    expect(swings[0]?.slot).toBe("UTIL");
    expect(swings[0]?.starterPlayer.sleeperId).toBe("2441");
    expect(swings[0]?.swing).toBe(4.25);
    expect(swings[0]?.starterLocked).toBe(false);
    expect(swings[0]?.benchLocked).toBe(true);

    expect(swings[1]?.benchPlayer.sleeperId).toBe("1074");
    expect(swings[1]?.slot).toBe("UTIL");
    expect(swings[1]?.starterPlayer.sleeperId).toBe("2713");
    expect(swings[1]?.swing).toBe(1.0);
    expect(swings[1]?.starterLocked).toBe(false);

    // Ensure no SG slot recommendation exists for Paul George
    expect(swings.some((s) => s.slot === "SG")).toBe(false);
  });

  it("flags starterLocked: true when a bench player has a positive swing over a locked starter", () => {
    // Suppose Fears (4750, slot G, locked at 41.75) had a lower lock or Coby White had a 50pt game
    const customLocks: LockRecord[] = realLocks.locks.map((l) =>
      l.sleeperId === "1074" ? { ...l, lockedTotal: 50.0 } : l,
    );
    const swings = evaluateBenchSwings(leg3, realPlayers.players, realLogs, customLocks);
    // At 50.00, Paul George (SF) also beats locked Lauri Markkanen (47.50) in slot F!
    const overMarkkanen = swings.find((s) => s.starterPlayer.sleeperId === "1752");
    expect(overMarkkanen).toBeDefined();
    expect(overMarkkanen?.slot).toBe("F");
    expect(overMarkkanen?.swing).toBe(2.5);
    expect(overMarkkanen?.starterLocked).toBe(true);
  });

  it("adviseWeek returns all 9 starters in STARTER_SLOTS order", () => {
    const rows = adviseWeek(leg3, realPlayers.players, realLogs, realLocks.locks);
    expect(rows).toHaveLength(9);
    expect(rows.map((r) => r.slot)).toEqual([
      "PG",
      "SG",
      "G",
      "SF",
      "PF",
      "F",
      "C",
      "UTIL",
      "UTIL",
    ]);
  });
});
