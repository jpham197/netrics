import { describe, expect, it } from "vitest";
import {
  LEAGUE_ID,
  type EspnPlayerMapFile,
  type GameLog,
  type PlayersFile,
  type WeeksFile,
} from "../data/types.js";
import {
  validateEspnPlayerMap,
  validateGameLogs,
  validatePlayers,
  validateWeeks,
} from "../data/validate.js";
import { parseSyncCliArgs } from "./sync-cli.js";
import { applySleeperSync } from "./syncApply.js";
import type { SleeperPlayerMeta, SleeperRosterEntry } from "./syncReport.js";

function makeBasePlayers(): PlayersFile {
  return {
    asOf: "2026-11-07",
    leagueId: LEAGUE_ID,
    players: [
      { sleeperId: "p1", name: "Guard One", team: "DET", positions: ["PG"], rosterStatus: "starter" },
      { sleeperId: "p2", name: "Guard Two", team: "PHI", positions: ["SG"], rosterStatus: "starter" },
      { sleeperId: "p3", name: "Guard Three", team: "NOP", positions: ["PG", "SG"], rosterStatus: "starter" },
      { sleeperId: "p4", name: "Forward One", team: "WAS", positions: ["SF"], rosterStatus: "starter" },
      { sleeperId: "p5", name: "Forward Two", team: "POR", positions: ["PF"], rosterStatus: "starter" },
      { sleeperId: "p6", name: "Forward Three", team: "UTA", positions: ["SF", "PF"], rosterStatus: "starter" },
      { sleeperId: "p7", name: "Center One", team: "SAC", positions: ["C"], rosterStatus: "starter" },
      { sleeperId: "p8", name: "Util One", team: "LAL", positions: ["C"], rosterStatus: "starter" },
      { sleeperId: "p9", name: "Util Two", team: "OKC", positions: ["SG"], rosterStatus: "starter" },
      { sleeperId: "p10", name: "Bench One", team: "BOS", positions: ["SF"], rosterStatus: "bench" },
      { sleeperId: "p11", name: "Bench Two", team: "NOP", positions: ["PF"], rosterStatus: "bench" },
      { sleeperId: "p12", name: "Reserve One", team: "SAC", positions: ["PF"], rosterStatus: "reserve" },
    ],
  };
}

function makeBaseMap(): EspnPlayerMapFile {
  return {
    leagueId: LEAGUE_ID,
    players: makeBasePlayers().players.map((p, idx) => ({
      sleeperId: p.sleeperId,
      espnAthleteId: String(4000000 + idx),
      name: p.name,
      espnTeam: p.team,
    })),
  };
}

function makeBaseWeeks(): WeeksFile {
  return {
    leagueId: LEAGUE_ID,
    weeks: [
      {
        leg: 3,
        startDate: "2026-11-02",
        endDate: "2026-11-08",
        matchupId: 4,
        opponentRosterId: 8,
        opponentName: "notNoah224",
        opponentPoints: 200,
        opponentAsOf: "2026-11-07T12:00:00Z",
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
        bench: ["p10", "p11"],
        reserve: ["p12"],
        remainingGames: {
          p1: ["2026-11-08"],
          p2: ["2026-11-08"],
          p3: ["2026-11-08"],
          p4: ["2026-11-08"],
          p5: ["2026-11-08"],
          p6: ["2026-11-08"],
          p7: ["2026-11-08"],
          p8: ["2026-11-08"],
          p9: ["2026-11-08"],
          p10: ["2026-11-08"],
          p11: ["2026-11-08"],
          p12: ["2026-11-08"],
        },
      },
    ],
  };
}

function makeSleeperPlayersMeta(): Record<string, SleeperPlayerMeta> {
  const base: Record<string, SleeperPlayerMeta> = {};
  for (const p of makeBasePlayers().players) {
    base[p.sleeperId] = {
      full_name: p.name,
      team: p.team,
      position: p.positions[0] ?? "UTIL",
      fantasy_positions: p.positions,
    };
  }
  base["p13"] = {
    full_name: "New Rookie",
    team: "GSW",
    position: "PG",
    fantasy_positions: ["PG", "SG"],
  };
  base["opp1"] = {
    full_name: "Opp Star",
    team: "MIA",
    position: "C",
    fantasy_positions: ["C"],
  };
  return base;
}

function makeMockFetch(
  scoreboardByDate: Record<string, unknown>,
  rosterBySlug: Record<string, unknown> = {},
  searchPayload: unknown = { items: [] },
): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/scoreboard?dates=")) {
      const m = /dates=(\d{8})/.exec(url);
      const compact = m?.[1] ?? "";
      const payload = scoreboardByDate[compact] ?? { events: [] };
      return new Response(JSON.stringify(payload), { status: 200 });
    }
    if (url.includes("/teams/") && url.includes("/roster")) {
      const m = /\/teams\/([^/]+)\/roster/.exec(url);
      const slug = m?.[1] ?? "";
      if (slug in rosterBySlug) {
        return new Response(JSON.stringify(rosterBySlug[slug]), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    }
    if (url.includes("/search?")) {
      return new Response(JSON.stringify(searchPayload), { status: 200 });
    }
    return new Response("Not Found", { status: 404 });
  }) as typeof fetch;
}

describe("applySleeperSync", () => {
  it("updates active leg slots, opponent snapshot, and remainingGames while excluding Final & logged dates", async () => {
    const playersFile = makeBasePlayers();
    const weeksFile = makeBaseWeeks();
    const espnPlayerMapFile = makeBaseMap();
    // p3 (NOP) has a game log on 2026-11-08; p11 is also on NOP (active bench) so both must exclude 2026-11-08
    const gameLogs: GameLog[] = [
      {
        sleeperId: "p3",
        date: "2026-11-08",
        opponent: "DAL",
        pts: 20,
        reb: 5,
        ast: 5,
        stl: 1,
        blk: 0,
        tov: 2,
        source: "ESPN box score 1",
      },
    ];
    const originalLogsSnapshot = JSON.stringify(gameLogs);

    const rosters: SleeperRosterEntry[] = [
      {
        roster_id: 1,
        owner_id: "u1",
        // Swap p10 (BOS) into starter UTIL2 (replacing p9)
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p10"],
        players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p10", "p9", "p11", "p12"],
        reserve: ["p12"],
      },
      { roster_id: 8, owner_id: "u8" },
    ];

    const matchups = [
      { roster_id: 1, matchup_id: 4, points: 250, starters: ["p1"], players_points: { p1: 30 } },
      {
        roster_id: 8,
        matchup_id: 4,
        points: 245.5,
        starters: ["opp1"],
        players_points: { opp1: 42.5 },
      },
    ];

    const fetchImpl = makeMockFetch({
      "20261108": {
        events: [
          {
            id: "ev1",
            date: "2026-11-08T23:00Z",
            status: { type: { completed: false, description: "Scheduled", name: "STATUS_SCHEDULED" } },
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "DET" } },
                  { homeAway: "away", team: { abbreviation: "PHI" } },
                ],
              },
            ],
          },
          {
            id: "ev2",
            date: "2026-11-08T18:00Z",
            status: { type: { completed: true, description: "Final", name: "STATUS_FINAL" } },
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "BOS" } },
                  { homeAway: "away", team: { abbreviation: "WAS" } },
                ],
              },
            ],
          },
          {
            id: "ev3",
            date: "2026-11-08T22:00Z",
            status: { type: { completed: false, description: "Scheduled", name: "STATUS_SCHEDULED" } },
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "NO" } },
                  { homeAway: "away", team: { abbreviation: "SAC" } },
                ],
              },
            ],
          },
        ],
      },
    });

    const result = await applySleeperSync({
      state: { leg: 3, season: "2026" },
      rosters,
      users: [{ user_id: "u8", display_name: "notNoah224" }],
      transactions: [],
      matchups,
      sleeperPlayers: makeSleeperPlayersMeta(),
      playersFile,
      weeksFile,
      espnPlayerMapFile,
      gameLogs,
      now: new Date("2026-11-08T15:00:00Z"),
      fetchImpl,
    });

    expect(result.changed).toBe(true);
    expect(result.createdNewLeg).toBe(false);
    expect(result.updatedPlayers.asOf).toBe("2026-11-08");
    expect(result.updatedPlayers.players.find((p) => p.sleeperId === "p10")?.rosterStatus).toBe("starter");
    expect(result.updatedPlayers.players.find((p) => p.sleeperId === "p9")?.rosterStatus).toBe("bench");

    const week3 = result.updatedWeeks.weeks.find((w) => w.leg === 3)!;
    expect(week3.opponentPoints).toBe(245.5);
    expect(week3.opponentPlayers?.[0]?.name).toBe("Opp Star");
    // DET & PHI are Scheduled -> remain
    expect(week3.remainingGames["p1"]).toEqual(["2026-11-08"]);
    expect(week3.remainingGames["p2"]).toEqual(["2026-11-08"]);
    // BOS & WAS are Final -> excluded
    expect(week3.remainingGames["p10"]).toEqual([]);
    expect(week3.remainingGames["p4"]).toEqual([]);
    // NO (NOP) is Scheduled, but p3 has a logged game on 2026-11-08 -> both p3 and active teammate p11 exclude 2026-11-08
    expect(week3.remainingGames["p3"]).toEqual([]);
    expect(week3.remainingGames["p11"]).toEqual([]);
    // SAC is Scheduled and not logged -> p7 & p12 keep 2026-11-08
    expect(week3.remainingGames["p7"]).toEqual(["2026-11-08"]);

    // gameLogs untouched
    expect(JSON.stringify(gameLogs)).toBe(originalLogsSnapshot);

    // Full validator compliance
    expect(validatePlayers(result.updatedPlayers)).toEqual([]);
    expect(validateGameLogs(gameLogs, result.updatedPlayers)).toEqual([]);
    expect(validateWeeks(result.updatedWeeks, result.updatedPlayers, gameLogs)).toEqual([]);
    expect(validateEspnPlayerMap(result.updatedEspnPlayerMap, result.updatedPlayers)).toEqual([]);
  });

  it("creates a new leg with Monday-Sunday cadence and resolves opponentName from /users", async () => {
    const playersFile = makeBasePlayers();
    const weeksFile = makeBaseWeeks();
    const espnPlayerMapFile = makeBaseMap();
    const gameLogs: GameLog[] = [];

    const rosters: SleeperRosterEntry[] = [
      {
        roster_id: 1,
        owner_id: "u1",
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
        players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"],
        reserve: ["p12"],
      },
      { roster_id: 5, owner_id: "u5" },
    ];

    const matchups = [
      { roster_id: 1, matchup_id: 2, points: 0, starters: ["p1"], players_points: {} },
      { roster_id: 5, matchup_id: 2, points: 12.5, starters: ["opp1"], players_points: { opp1: 12.5 } },
    ];

    const fetchImpl = makeMockFetch({
      "20261109": {
        events: [
          {
            id: "ev10",
            date: "2026-11-09T23:00Z",
            status: { type: { completed: false, description: "Scheduled" } },
            competitions: [
              {
                competitors: [
                  { homeAway: "home", team: { abbreviation: "DET" } },
                  { homeAway: "away", team: { abbreviation: "LAL" } },
                ],
              },
            ],
          },
        ],
      },
    });

    const result = await applySleeperSync({
      state: { leg: 4, season: "2026" },
      rosters,
      users: [{ user_id: "u5", display_name: "HoopsChamp" }],
      transactions: [],
      matchups,
      sleeperPlayers: makeSleeperPlayersMeta(),
      playersFile,
      weeksFile,
      espnPlayerMapFile,
      gameLogs,
      now: new Date("2026-11-09T14:00:00Z"),
      fetchImpl,
    });

    expect(result.createdNewLeg).toBe(true);
    expect(result.updatedWeeks.weeks).toHaveLength(2);
    const week4 = result.updatedWeeks.weeks.find((w) => w.leg === 4)!;
    expect(week4.startDate).toBe("2026-11-09");
    expect(week4.endDate).toBe("2026-11-15");
    expect(week4.matchupId).toBe(2);
    expect(week4.opponentRosterId).toBe(5);
    expect(week4.opponentName).toBe("HoopsChamp");
    expect(week4.remainingGames["p1"]).toEqual(["2026-11-09"]);
    expect(week4.remainingGames["p8"]).toEqual(["2026-11-09"]);
    expect(result.prMetadata.branchName).toBe("sync/sleeper-leg-4");

    expect(validateWeeks(result.updatedWeeks, result.updatedPlayers, gameLogs)).toEqual([]);
  });

  it("retains dropped player with game logs as reserve in players.json (excluded from WeekRecord) and removes dropped player without logs", async () => {
    const playersFile = makeBasePlayers();
    const weeksFile = makeBaseWeeks();
    const espnPlayerMapFile = makeBaseMap();

    // p10 (BOS) has a game log and is dropped; p11 (NOP) has NO game logs and is dropped.
    const gameLogs: GameLog[] = [
      {
        sleeperId: "p10",
        date: "2026-11-04",
        opponent: "MIA",
        pts: 15,
        reb: 4,
        ast: 3,
        stl: 1,
        blk: 0,
        tov: 1,
        source: "ESPN box score 99",
      },
    ];

    const rosters: SleeperRosterEntry[] = [
      {
        roster_id: 1,
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
        players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p12"],
        reserve: ["p12"],
      },
      { roster_id: 8 },
    ];

    const matchups = [
      { roster_id: 1, matchup_id: 4, points: 100, starters: ["p1"], players_points: {} },
      { roster_id: 8, matchup_id: 4, points: 200, starters: ["opp1"], players_points: {} },
    ];

    const result = await applySleeperSync({
      state: { leg: 3 },
      rosters,
      users: [],
      transactions: [],
      matchups,
      sleeperPlayers: makeSleeperPlayersMeta(),
      playersFile,
      weeksFile,
      espnPlayerMapFile,
      gameLogs,
      now: new Date("2026-11-08T15:00:00Z"),
      fetchImpl: makeMockFetch({}),
    });

    // p10 retained as reserve in players.json & espn-player-map.json
    const retained = result.updatedPlayers.players.find((p) => p.sleeperId === "p10");
    expect(retained?.rosterStatus).toBe("reserve");
    expect(result.retainedDroppedPlayers.map((p) => p.sleeperId)).toEqual(["p10"]);
    expect(result.updatedEspnPlayerMap.players.some((e) => e.sleeperId === "p10")).toBe(true);

    // p10 MUST NOT be in WeekRecord.starters, bench, or reserve
    const week3 = result.updatedWeeks.weeks.find((w) => w.leg === 3)!;
    expect(week3.starters).not.toContain("p10");
    expect(week3.bench).not.toContain("p10");
    expect(week3.reserve).not.toContain("p10");
    expect(week3.remainingGames["p10"]).toBeUndefined();

    // p11 removed from players.json & espn-player-map.json
    expect(result.removedDroppedPlayerIds).toEqual(["p11"]);
    expect(result.updatedPlayers.players.some((p) => p.sleeperId === "p11")).toBe(false);
    expect(result.updatedEspnPlayerMap.players.some((e) => e.sleeperId === "p11")).toBe(false);

    expect(validatePlayers(result.updatedPlayers)).toEqual([]);
    expect(validateGameLogs(gameLogs, result.updatedPlayers)).toEqual([]);
    expect(validateWeeks(result.updatedWeeks, result.updatedPlayers, gameLogs)).toEqual([]);
    expect(validateEspnPlayerMap(result.updatedEspnPlayerMap, result.updatedPlayers)).toEqual([]);
  });

  it("resolves ESPN athlete ID for a newly added Sleeper player via team roster endpoint", async () => {
    const playersFile = makeBasePlayers();
    const weeksFile = makeBaseWeeks();
    const espnPlayerMapFile = makeBaseMap();

    const rosters: SleeperRosterEntry[] = [
      {
        roster_id: 1,
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
        players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13"],
        reserve: ["p12"],
      },
      { roster_id: 8 },
    ];

    const matchups = [
      { roster_id: 1, matchup_id: 4, points: 100, starters: ["p1"], players_points: {} },
      { roster_id: 8, matchup_id: 4, points: 200, starters: ["opp1"], players_points: {} },
    ];

    const fetchImpl = makeMockFetch(
      {},
      {
        gs: {
          team: { abbreviation: "GS" },
          athletes: [{ id: "5551234", fullName: "New Rookie" }],
        },
      },
    );

    const result = await applySleeperSync({
      state: { leg: 3 },
      rosters,
      users: [],
      transactions: [],
      matchups,
      sleeperPlayers: makeSleeperPlayersMeta(),
      playersFile,
      weeksFile,
      espnPlayerMapFile,
      gameLogs: [],
      now: new Date("2026-11-08T15:00:00Z"),
      fetchImpl,
    });

    expect(result.addedPlayers.map((p) => p.sleeperId)).toEqual(["p13"]);
    const mapEntry = result.updatedEspnPlayerMap.players.find((e) => e.sleeperId === "p13");
    expect(mapEntry).toEqual({
      sleeperId: "p13",
      espnAthleteId: "5551234",
      name: "New Rookie",
      espnTeam: "GSW",
    });
    expect(validateEspnPlayerMap(result.updatedEspnPlayerMap, result.updatedPlayers)).toEqual([]);
  });

  it("throws a clear error when a new player cannot be resolved on ESPN", async () => {
    const playersFile = makeBasePlayers();
    const weeksFile = makeBaseWeeks();
    const espnPlayerMapFile = makeBaseMap();

    const rosters: SleeperRosterEntry[] = [
      {
        roster_id: 1,
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
        players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13"],
        reserve: ["p12"],
      },
      { roster_id: 8 },
    ];

    const matchups = [
      { roster_id: 1, matchup_id: 4, points: 100, starters: ["p1"], players_points: {} },
      { roster_id: 8, matchup_id: 4, points: 200, starters: ["opp1"], players_points: {} },
    ];

    await expect(
      applySleeperSync({
        state: { leg: 3 },
        rosters,
        users: [],
        transactions: [],
        matchups,
        sleeperPlayers: makeSleeperPlayersMeta(),
        playersFile,
        weeksFile,
        espnPlayerMapFile,
        gameLogs: [],
        now: new Date("2026-11-08T15:00:00Z"),
        fetchImpl: makeMockFetch({}, {}, { items: [] }),
      }),
    ).rejects.toThrow(/Could not resolve ESPN athlete ID/);
  });

  it("returns changed: false and preserves opponentAsOf and players.asOf on a no-op run", async () => {
    const playersFile = makeBasePlayers();
    const weeksFile = makeBaseWeeks();
    weeksFile.weeks[0]!.opponentPlayers = [
      { sleeperId: "opp1", name: "Opp Star", position: "C", team: "MIA", points: 25 },
    ];
    // Clear remainingGames for all players so empty scoreboard matches
    for (const k of Object.keys(weeksFile.weeks[0]!.remainingGames)) {
      weeksFile.weeks[0]!.remainingGames[k] = [];
    }
    const espnPlayerMapFile = makeBaseMap();

    const rosters: SleeperRosterEntry[] = [
      {
        roster_id: 1,
        owner_id: "u1",
        starters: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9"],
        players: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"],
        reserve: ["p12"],
      },
      { roster_id: 8, owner_id: "u8" },
    ];

    const matchups = [
      { roster_id: 1, matchup_id: 4, points: 100, starters: ["p1"], players_points: { p1: 20 } },
      {
        roster_id: 8,
        matchup_id: 4,
        points: 200,
        starters: ["opp1"],
        players_points: { opp1: 25 },
      },
    ];

    const result = await applySleeperSync({
      state: { leg: 3 },
      rosters,
      users: [{ user_id: "u8", display_name: "notNoah224" }],
      transactions: [],
      matchups,
      sleeperPlayers: makeSleeperPlayersMeta(),
      playersFile,
      weeksFile,
      espnPlayerMapFile,
      gameLogs: [],
      // Later timestamp than playersFile.asOf ("2026-11-07") and opponentAsOf ("2026-11-07T12:00:00Z")
      now: new Date("2026-11-10T15:00:00Z"),
      fetchImpl: makeMockFetch({}),
    });

    expect(result.changed).toBe(false);
    expect(result.playersChanged).toBe(false);
    expect(result.weeksChanged).toBe(false);
    expect(result.mapChanged).toBe(false);
    expect(result.prMetadata.changed).toBe(false);
    expect(result.updatedPlayers.asOf).toBe("2026-11-07");
    expect(result.updatedWeeks.weeks[0]?.opponentAsOf).toBe("2026-11-07T12:00:00Z");
  });
});

describe("parseSyncCliArgs", () => {
  it("supports default read-only mode and positional args", () => {
    const parsed = parseSyncCliArgs(["custom/players.json", "custom/weeks.json"], "/repo");
    expect(parsed.applyToData).toBe(false);
    expect(parsed.prMetaOutPath).toBeNull();
    expect(parsed.playersPath).toBe("/repo/custom/players.json");
    expect(parsed.weeksPath).toBe("/repo/custom/weeks.json");
  });

  it("supports --apply-to-data and --pr-meta-out outside data/", () => {
    const parsed = parseSyncCliArgs(
      ["--apply-to-data", "--pr-meta-out", "/tmp/sync-pr-meta.json"],
      "/repo",
    );
    expect(parsed.applyToData).toBe(true);
    expect(parsed.prMetaOutPath).toBe("/tmp/sync-pr-meta.json");
  });

  it("rejects --pr-meta-out inside data/", () => {
    expect(() =>
      parseSyncCliArgs(["--apply-to-data", "--pr-meta-out", "data/meta.json"], "/repo"),
    ).toThrow(/data\//i);
  });

  it("rejects unknown flags", () => {
    expect(() => parseSyncCliArgs(["--bogus"], "/repo")).toThrow(/Unknown CLI argument/);
  });
});
