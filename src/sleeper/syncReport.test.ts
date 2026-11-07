// Stage 5b unit tests — pure read-only roster & week sync diff report (`src/sleeper/syncReport.ts`).

import { describe, expect, it } from "vitest";
import { loadPlayers, loadWeeks } from "../data/load.js";
import type { PlayersFile, WeekRecord } from "../data/types.js";
import { buildSyncReport, type SleeperRosterEntry } from "./syncReport.js";

describe("buildSyncReport (Stage 5b)", () => {
  const realPlayers = loadPlayers("data/players.json");
  const realWeeks = loadWeeks("data/weeks.json");
  const leg3 = realWeeks.weeks[0] as WeekRecord;

  function makeSyncedSleeperRoster(): SleeperRosterEntry {
    return {
      roster_id: 1,
      starters: [...leg3.starters],
      reserve: [...leg3.reserve],
      players: [...leg3.starters, ...leg3.bench, ...leg3.reserve],
    };
  }

  function makeMatchupsPayload(oppPoints: number, userPoints = 407.25) {
    return [
      {
        roster_id: 1,
        matchup_id: leg3.matchupId,
        points: userPoints,
        starters: leg3.starters,
        players_points: {},
      },
      {
        roster_id: leg3.opponentRosterId,
        matchup_id: leg3.matchupId,
        points: oppPoints,
        starters: ["3001"],
        players_points: { "3001": oppPoints },
      },
    ];
  }

  it("reports hasActionableDiffs === false when leg and Roster 1 match, even if live opponent points moved", () => {
    const report = buildSyncReport({
      state: { leg: 3, week: 3, season: "2026" },
      rosters: [makeSyncedSleeperRoster()],
      transactions: [],
      matchups: makeMatchupsPayload(355.5), // moved from stored 317.25 (+38.25)
      playersFile: realPlayers,
      weeksFile: realWeeks,
    });

    expect(report.hasActionableDiffs).toBe(false);
    expect(report.legDiff.missingCurrentLeg).toBe(false);
    expect(report.rosterDiffs.missingFromLocal).toEqual([]);
    expect(report.rosterDiffs.droppedFromSleeper).toEqual([]);
    expect(report.rosterDiffs.slotMismatches).toEqual([]);
    expect(report.matchupDiff).toEqual({
      leg: 3,
      storedOpponentPoints: 317.25,
      liveOpponentPoints: 355.5,
      opponentDelta: 38.25,
      liveUserPoints: 407.25,
      opponentStarters: [
        {
          sleeperId: "3001",
          name: "Player #3001",
          position: "?",
          team: "FA",
          points: 355.5,
        },
      ],
    });
    expect(report.textReport).toContain("IN SYNC (exit 0)");
    expect(report.textReport).toContain("delta +38.25");
    expect(report.textReport).toContain("Opponent Starters: Player #3001 (3001, ?·FA): 355.50");
  });

  it("detects dropped players (e.g. Jarace Walker 2563), newly added Sleeper players, slot mismatches, and missing current leg", () => {
    // Simulate local playersFile still having Jarace Walker (2563) and missing Nolan Traore (4742)
    const stalePlayersFile: PlayersFile = {
      ...realPlayers,
      players: [
        ...realPlayers.players
          .filter((p) => p.sleeperId !== "4742")
          .map((p) =>
            p.sleeperId === "1074" ? { ...p, rosterStatus: "starter" as const } : p,
          ),
        {
          sleeperId: "2563",
          name: "Jarace Walker",
          team: "IND",
          positions: ["PF"],
          rosterStatus: "bench",
        },
      ],
    };

    const report = buildSyncReport({
      state: { leg: 4, week: 4, season: "2026" },
      rosters: [makeSyncedSleeperRoster()],
      transactions: [
        {
          type: "free_agent",
          status: "complete",
          status_updated: Date.parse("2026-11-05T14:00:00Z"),
          adds: { "4742": 1 },
          drops: { "2563": 1 },
        },
      ],
      matchups: makeMatchupsPayload(317.25),
      sleeperPlayers: {
        "4742": { full_name: "Nolan Traore", team: "BKN", position: "PG" },
        "2563": { full_name: "Jarace Walker", team: "IND", position: "PF" },
      },
      playersFile: stalePlayersFile,
      weeksFile: realWeeks,
    });

    expect(report.hasActionableDiffs).toBe(true);
    expect(report.legDiff.missingCurrentLeg).toBe(true);
    expect(report.legDiff.sleeperLeg).toBe(4);
    expect(report.legDiff.latestLocalLeg).toBe(3);

    expect(report.rosterDiffs.missingFromLocal).toEqual([
      {
        sleeperId: "4742",
        name: "Nolan Traore",
        team: "BKN",
        position: "PG",
        sleeperSlot: "bench",
      },
    ]);

    expect(report.rosterDiffs.droppedFromSleeper).toEqual([
      {
        sleeperId: "2563",
        name: "Jarace Walker",
        team: "IND",
        localStatus: "bench",
        source: "players.json",
      },
    ]);

    expect(report.rosterDiffs.slotMismatches.some((s) => s.sleeperId === "1074")).toBe(true);
    expect(report.transactions.length).toBe(1);
    expect(report.transactions[0]?.dropped[0]).toContain("Jarace Walker (2563, IND)");
    expect(report.transactions[0]?.added[0]).toContain("Nolan Traore (4742, BKN)");
    expect(report.textReport).toContain("OUT OF SYNC (exit 1)");
    expect(report.textReport).toContain("DROPPED FROM SLEEPER: Jarace Walker (2563, IND)");
    expect(report.textReport).toContain("MISSING FROM LOCAL: Nolan Traore (4742, PG · BKN)");
  });
});
