// Opaque-box E2E tests for F2: Sleeper Roster & Week Auto-Sync (`--apply-to-data`).
// Never mutates repo `data/*.json` or calls live network APIs.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAGUE_ID } from "../../src/data/types.js";
import { validateAll } from "../../src/data/validate.js";
import {
  createTempDataWorkspace,
  makeEspnScoreboardPayload,
  type TempDataWorkspace,
} from "./fixtures/e2eFixtures.js";

function buildSleeperMockFetch(options: {
  leg: number;
  starters: string[];
  bench: string[];
  reserve: string[];
  extraPlayersMeta?: Record<string, { full_name: string; team: string; fantasy_positions: string[] }>;
  espnScheduleByDate?: Record<string, Array<{ eventId: string; homeTeam: string; awayTeam: string }>>;
  espnAthletes?: Array<{ id: string; displayName: string; teamAbbr: string }>;
  opponentPoints?: number;
}) {
  const allRosterPlayers = [...options.starters, ...options.bench, ...options.reserve];
  const baseMeta: Record<string, { full_name: string; team: string; fantasy_positions: string[] }> = {
    "s-pg-1": { full_name: "Jalen Brunson", team: "NYK", fantasy_positions: ["PG"] },
    "s-sg-1": { full_name: "Devin Booker", team: "PHX", fantasy_positions: ["SG", "PG"] },
    "s-g-1": { full_name: "Tyrese Haliburton", team: "IND", fantasy_positions: ["PG", "SG"] },
    "s-sf-1": { full_name: "Jayson Tatum", team: "BOS", fantasy_positions: ["SF", "PF"] },
    "s-pf-1": { full_name: "Giannis Antetokounmpo", team: "MIL", fantasy_positions: ["PF", "C"] },
    "s-f-1": { full_name: "Franz Wagner", team: "ORL", fantasy_positions: ["SF", "PF"] },
    "s-c-1": { full_name: "Nikola Jokic", team: "DEN", fantasy_positions: ["C"] },
    "s-u1-1": { full_name: "Shai Gilgeous-Alexander", team: "OKC", fantasy_positions: ["PG", "SG"] },
    "s-u2-1": { full_name: "Anthony Davis", team: "LAL", fantasy_positions: ["PF", "C"] },
    "s-b1-1": { full_name: "Darius Garland", team: "CLE", fantasy_positions: ["PG"] },
    "s-b2-1": { full_name: "Bam Adebayo", team: "MIA", fantasy_positions: ["C"] },
    "s-r1-1": { full_name: "Paolo Banchero", team: "ORL", fantasy_positions: ["PF", "SF"] },
    ...options.extraPlayersMeta,
  };

  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/state/nba")) {
      return new Response(JSON.stringify({ leg: options.leg, week: options.leg, season: "2026" }), { status: 200 });
    }
    if (url.endsWith(`/league/${LEAGUE_ID}/rosters`)) {
      return new Response(
        JSON.stringify([
          { roster_id: 1, players: allRosterPlayers, starters: options.starters, reserve: options.reserve },
          { roster_id: 2, players: ["opp-1"], starters: ["opp-1"], reserve: [] },
        ]),
        { status: 200 },
      );
    }
    if (url.includes(`/league/${LEAGUE_ID}/transactions/`)) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.includes(`/league/${LEAGUE_ID}/matchups/`)) {
      return new Response(
        JSON.stringify([
          { roster_id: 1, matchup_id: 1, points: 310.0, starters: options.starters, players_points: {} },
          {
            roster_id: 2,
            matchup_id: 1,
            points: options.opponentPoints ?? 355.25,
            starters: ["opp-1"],
            players_points: { "opp-1": 62.5 },
          },
        ]),
        { status: 200 },
      );
    }
    if (url.endsWith(`/league/${LEAGUE_ID}/users`)) {
      return new Response(JSON.stringify([{ user_id: "u2", display_name: "HoopsRival" }]), { status: 200 });
    }
    if (url.endsWith("/players/nba")) {
      return new Response(JSON.stringify(baseMeta), { status: 200 });
    }
    if (url.includes("site.api.espn.com") && url.includes("scoreboard")) {
      const match = /dates=(\d{4})(\d{2})(\d{2})/.exec(url);
      const dateStr = match ? `${match[1]}-${match[2]}-${match[3]}` : "2026-11-06";
      const games = options.espnScheduleByDate?.[dateStr] ?? [];
      return new Response(JSON.stringify(makeEspnScoreboardPayload(dateStr, games)), { status: 200 });
    }
    if (url.includes("espn.com") && url.includes("/teams/") && url.includes("/roster")) {
      return new Response(
        JSON.stringify({
          athletes: (options.espnAthletes ?? []).map((a) => ({
            id: a.id,
            displayName: a.displayName,
            fullName: a.displayName,
          })),
          team: { abbreviation: options.espnAthletes?.[0]?.teamAbbr },
        }),
        { status: 200 },
      );
    }
    if (url.includes("espn.com") && (url.includes("apis/common/v3/search") || url.includes("athletes"))) {
      return new Response(
        JSON.stringify({
          items: (options.espnAthletes ?? []).map((a) => ({
            id: a.id,
            displayName: a.displayName,
            fullName: a.displayName,
            team: { abbreviation: a.teamAbbr },
          })),
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

describe("F2: Sleeper Roster & Week Auto-Sync E2E", () => {
  let ws: TempDataWorkspace;

  beforeEach(() => {
    ws = createTempDataWorkspace();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ws.cleanup();
  });

  // Tier 1
  it("Tier 1: syncApply updates players.json when a bench player is promoted to starter", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const starters = [
      "s-b1-1", // Darius Garland promoted to PG
      "s-sg-1",
      "s-g-1",
      "s-sf-1",
      "s-pf-1",
      "s-f-1",
      "s-c-1",
      "s-u1-1",
      "s-u2-1",
    ];
    const bench = ["s-pg-1", "s-b2-1"];
    const reserve = ["s-r1-1"];

    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters,
        bench,
        reserve,
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const updatedPlayers = ws.readPlayers();
    const garland = updatedPlayers.players.find((p) => p.sleeperId === "s-b1-1");
    const brunson = updatedPlayers.players.find((p) => p.sleeperId === "s-pg-1");
    expect(garland?.rosterStatus).toBe("starter");
    expect(brunson?.rosterStatus).toBe("bench");

    const updatedWeeks = ws.readWeeks();
    const leg3 = updatedWeeks.weeks.find((w) => w.leg === 3);
    expect(leg3?.starters).toContain("s-b1-1");
    expect(leg3?.starters).not.toContain("s-pg-1");
    expect(leg3?.bench).toContain("s-pg-1");
    expect(leg3?.bench).not.toContain("s-b1-1");
    expect(
      validateAll(updatedPlayers, ws.readLogs(), updatedWeeks, ws.readLocks(), ws.readEspnMap()),
    ).toEqual([]);
  });

  it("Tier 1: updates active leg weeks.json with remainingGames from ESPN schedule excluding already-logged dates across starters, bench, and reserve", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
        espnScheduleByDate: {
          // 2026-11-02 is already in game-logs.json for s-pg-1 (NYK), so must be excluded!
          "2026-11-02": [{ eventId: "e1", homeTeam: "NYK", awayTeam: "CHI", isFinal: true }],
          "2026-11-06": [
            { eventId: "e2", homeTeam: "NYK", awayTeam: "MIL", isFinal: false },
            { eventId: "e4", homeTeam: "CLE", awayTeam: "ORL", isFinal: false },
          ],
          "2026-11-08": [{ eventId: "e3", homeTeam: "BOS", awayTeam: "NYK", isFinal: false }],
        },
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const weeks = ws.readWeeks();
    const leg3 = weeks.weeks.find((w) => w.leg === 3);
    expect(leg3?.remainingGames["s-pg-1"]).toEqual(["2026-11-06", "2026-11-08"]);
    expect(leg3?.remainingGames["s-pg-1"]).not.toContain("2026-11-02");
    expect(leg3?.remainingGames["s-b1-1"]).toEqual(["2026-11-06"]);
    expect(leg3?.remainingGames["s-r1-1"]).toEqual(["2026-11-06"]);
    expect(leg3?.remainingGames["s-f-1"]).toEqual(["2026-11-06"]);
  });

  it("Tier 1: creates a new WeekRecord when Sleeper leg advances past latest local leg", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 4,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
        espnScheduleByDate: {
          "2026-11-10": [{ eventId: "e401", homeTeam: "NYK", awayTeam: "DEN", isFinal: false }],
        },
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const weeks = ws.readWeeks();
    const leg4 = weeks.weeks.find((w) => w.leg === 4);
    expect(leg4).toBeDefined();
    expect(leg4?.starters).toHaveLength(9);
    expect(leg4?.bench).toEqual(["s-b1-1", "s-b2-1"]);
    expect(leg4?.reserve).toEqual(["s-r1-1"]);
    expect(leg4?.startDate > "2026-11-08").toBe(true);
    expect(leg4?.endDate >= leg4!.startDate).toBe(true);
    expect(leg4?.remainingGames["s-pg-1"]).toContain("2026-11-10");
    expect(
      validateAll(ws.readPlayers(), ws.readLogs(), weeks, ws.readLocks(), ws.readEspnMap()),
    ).toEqual([]);
  });

  it("Tier 1: resolves newly added Sleeper player ESPN athlete ID into espn-player-map.json", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1", "s-new-1"],
        reserve: ["s-r1-1"],
        extraPlayersMeta: {
          "s-new-1": { full_name: "Cade Cunningham", team: "DET", fantasy_positions: ["PG", "SG"] },
        },
        espnAthletes: [{ id: "4432166", displayName: "Cade Cunningham", teamAbbr: "DET" }],
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const espnMap = ws.readEspnMap();
    const cade = espnMap.players.find((p) => p.sleeperId === "s-new-1");
    expect(cade).toBeDefined();
    expect(cade?.espnAthleteId).toBe("4432166");
    expect(cade?.espnTeam).toBe("DET");
  });

  it("Tier 1: preserves locks.json and game-logs.json completely untouched", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const locksBefore = readFileSync(ws.locksPath, "utf-8");
    const logsBefore = readFileSync(ws.logsPath, "utf-8");

    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    expect(readFileSync(ws.locksPath, "utf-8")).toBe(locksBefore);
    expect(readFileSync(ws.logsPath, "utf-8")).toBe(logsBefore);
  });

  // Tier 2
  it("Tier 2: retains dropped player with existing game-logs.json as rosterStatus='reserve' and passes validateAll", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    // Drop s-b2-1 (Bam Adebayo, who has a game log on 2026-11-03) from Sleeper roster
    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1"],
        reserve: ["s-r1-1"],
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const players = ws.readPlayers();
    const bam = players.players.find((p) => p.sleeperId === "s-b2-1");
    expect(bam).toBeDefined();
    expect(bam?.rosterStatus).toBe("reserve");

    const errors = validateAll(players, ws.readLogs(), ws.readWeeks(), ws.readLocks(), ws.readEspnMap());
    expect(errors).toEqual([]);
  });

  it("Tier 2: unmapped new player fails/flags cleanly without corrupting espn-player-map.json", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const espnMapBefore = readFileSync(ws.espnMapPath, "utf-8");

    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1", "s-unmapped-999"],
        reserve: ["s-r1-1"],
        extraPlayersMeta: {
          "s-unmapped-999": { full_name: "Unknown Rookie", team: "WAS", fantasy_positions: ["SG"] },
        },
        espnAthletes: [],
      }),
    );

    await expect(
      syncApplyMod.runSleeperSyncApply({
        playersPath: ws.playersPath,
        weeksPath: ws.weeksPath,
        logsPath: ws.logsPath,
        espnMapPath: ws.espnMapPath,
        applyToData: true,
      }),
    ).rejects.toThrow();

    expect(readFileSync(ws.espnMapPath, "utf-8")).toBe(espnMapBefore);
  });

  it("Tier 2: --apply-to-data is idempotent on second run with identical Sleeper/ESPN state", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const mockFetch = buildSleeperMockFetch({
      leg: 3,
      starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
      bench: ["s-b1-1", "s-b2-1"],
      reserve: ["s-r1-1"],
      espnScheduleByDate: {
        "2026-11-06": [{ eventId: "e2", homeTeam: "NYK", awayTeam: "MIL", isFinal: false }],
      },
    });
    vi.stubGlobal("fetch", mockFetch);

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });
    const firstPlayers = readFileSync(ws.playersPath, "utf-8");
    const firstWeeks = readFileSync(ws.weeksPath, "utf-8");
    const firstMap = readFileSync(ws.espnMapPath, "utf-8");

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    expect(readFileSync(ws.playersPath, "utf-8")).toBe(firstPlayers);
    expect(readFileSync(ws.weeksPath, "utf-8")).toBe(firstWeeks);
    expect(readFileSync(ws.espnMapPath, "utf-8")).toBe(firstMap);
  });

  it("Tier 2: produces empty remainingGames when all week dates in [startDate, endDate] are already logged", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
        espnScheduleByDate: {
          "2026-11-02": [{ eventId: "e1", homeTeam: "NYK", awayTeam: "CHI", isFinal: true }],
          "2026-11-04": [{ eventId: "e2", homeTeam: "WAS", awayTeam: "NYK", isFinal: true }],
        },
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const leg3 = ws.readWeeks().weeks.find((w) => w.leg === 3);
    expect(leg3?.remainingGames["s-pg-1"]).toEqual([]);
  });

  it("Tier 2: dry-run (applyToData: false) writes 0 files", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const playersBefore = readFileSync(ws.playersPath, "utf-8");
    const weeksBefore = readFileSync(ws.weeksPath, "utf-8");
    const mapBefore = readFileSync(ws.espnMapPath, "utf-8");

    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 4,
        starters: ["s-b1-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
        bench: ["s-pg-1", "s-b2-1"],
        reserve: ["s-r1-1"],
      }),
    );

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: false,
    });

    expect(readFileSync(ws.playersPath, "utf-8")).toBe(playersBefore);
    expect(readFileSync(ws.weeksPath, "utf-8")).toBe(weeksBefore);
    expect(readFileSync(ws.espnMapPath, "utf-8")).toBe(mapBefore);
  });
});
