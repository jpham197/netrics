// Tier 5 Adversarial Backend E2E Tests (Phase 2).
// Covers partial HTTP failures, slot eligibility violations, duplicate Sleeper IDs,
// retained dropped player idempotency, DNP-only Final games, DST/UTC-midnight boundaries,
// multi-day leg reconciliation scopes, and malformed box scores / teammate schedule conflicts.
// Never mutates repo `data/*.json` or calls live network APIs.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAGUE_ID } from "../../src/data/types.js";
import { validateAll, validateGameLogs } from "../../src/data/validate.js";
import {
  applyIngestionProposal,
  computeCatchUpDates,
  computeEasternDateWindow,
  extractPlayerBoxScoresFromSummary,
  runEspnIngestion,
} from "../../src/espn/ingest.js";
import { parseIngestCliArgs } from "../../src/espn/ingest-cli.js";
import { fantasyPoints } from "../../src/scoring/index.js";
import {
  createTempDataWorkspace,
  makeEspnScoreboardPayload,
  makeEspnSummaryPayload,
  type TempDataWorkspace,
} from "./fixtures/e2eFixtures.js";

function buildSleeperMockFetch(options: {
  leg: number;
  starters: string[];
  bench: string[];
  reserve: string[];
  rawPlayersField?: string[];
  rawReserveField?: string[];
  espnScheduleByDate?: Record<
    string,
    Array<{ eventId: string; homeTeam: string; awayTeam: string; isFinal?: boolean }>
  >;
}) {
  const allRosterPlayers =
    options.rawPlayersField ?? [...options.starters, ...options.bench, ...options.reserve];
  const reserveField = options.rawReserveField ?? options.reserve;

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
  };

  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/state/nba")) {
      return new Response(JSON.stringify({ leg: options.leg, week: options.leg, season: "2026" }), {
        status: 200,
      });
    }
    if (url.endsWith(`/league/${LEAGUE_ID}/rosters`)) {
      return new Response(
        JSON.stringify([
          {
            roster_id: 1,
            players: allRosterPlayers,
            starters: options.starters,
            reserve: reserveField,
          },
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
            points: 342.5,
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
    return new Response(JSON.stringify({}), { status: 200 });
  };
}

describe("Tier 5 Adversarial Backend E2E", () => {
  let ws: TempDataWorkspace;

  beforeEach(() => {
    ws = createTempDataWorkspace();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ws.cleanup();
  });

  it("T5-1: partial ESPN HTTP 500 failure on day 2 of --from/--to backfill leaves workspace immutable", async () => {
    const snapshots = {
      players: readFileSync(ws.playersPath, "utf-8"),
      logs: readFileSync(ws.logsPath, "utf-8"),
      weeks: readFileSync(ws.weeksPath, "utf-8"),
      locks: readFileSync(ws.locksPath, "utf-8"),
      espnMap: readFileSync(ws.espnMapPath, "utf-8"),
    };

    const parsed = parseIngestCliArgs(["--from", "2026-11-06", "--to", "2026-11-07"]);
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("scoreboard") && url.includes("dates=20261106")) {
        return new Response(
          JSON.stringify(
            makeEspnScoreboardPayload("2026-11-06", [
              { eventId: "ev-1106", homeTeam: "NYK", awayTeam: "MIL", isFinal: true },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-1106")) {
        return new Response(
          JSON.stringify(
            makeEspnSummaryPayload([
              {
                teamAbbr: "NYK",
                athletes: [
                  { espnAthleteId: "3934672", displayName: "Jalen Brunson", min: "35:00", pts: 30, reb: 4, ast: 8, stl: 1, blk: 0, tov: 2 },
                ],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("scoreboard") && url.includes("dates=20261107")) {
        return new Response("Internal Server Error", { status: 500 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    await expect(
      runEspnIngestion({
        dates: parsed.dates,
        verifyExisting: false,
        playersFile: ws.readPlayers(),
        espnPlayerMap: ws.readEspnMap(),
        existingLogs: ws.readLogs(),
        weeksFile: ws.readWeeks(),
        locksFile: ws.readLocks(),
        fetchImpl: fetchMock as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500/);

    expect(readFileSync(ws.playersPath, "utf-8")).toBe(snapshots.players);
    expect(readFileSync(ws.logsPath, "utf-8")).toBe(snapshots.logs);
    expect(readFileSync(ws.weeksPath, "utf-8")).toBe(snapshots.weeks);
    expect(readFileSync(ws.locksPath, "utf-8")).toBe(snapshots.locks);
    expect(readFileSync(ws.espnMapPath, "utf-8")).toBe(snapshots.espnMap);
  });

  it("T5-2: Sleeper sync starter slot eligibility violation leaves all 5 workspace files untouched", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const snapshots = {
      players: readFileSync(ws.playersPath, "utf-8"),
      logs: readFileSync(ws.logsPath, "utf-8"),
      weeks: readFileSync(ws.weeksPath, "utf-8"),
      locks: readFileSync(ws.locksPath, "utf-8"),
      espnMap: readFileSync(ws.espnMapPath, "utf-8"),
    };

    // Place C-only Nikola Jokic (s-c-1) into PG slot (index 0) and PG Jalen Brunson into C slot (index 6)
    const invalidStarters = [
      "s-c-1",
      "s-sg-1",
      "s-g-1",
      "s-sf-1",
      "s-pf-1",
      "s-f-1",
      "s-pg-1",
      "s-u1-1",
      "s-u2-1",
    ];

    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters: invalidStarters,
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
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
    ).rejects.toThrow(/ineligible for slot PG/);

    expect(readFileSync(ws.playersPath, "utf-8")).toBe(snapshots.players);
    expect(readFileSync(ws.logsPath, "utf-8")).toBe(snapshots.logs);
    expect(readFileSync(ws.weeksPath, "utf-8")).toBe(snapshots.weeks);
    expect(readFileSync(ws.locksPath, "utf-8")).toBe(snapshots.locks);
    expect(readFileSync(ws.espnMapPath, "utf-8")).toBe(snapshots.espnMap);
  });

  it("T5-3: duplicate player IDs in Sleeper roster.reserve / roster.players are deduplicated cleanly and pass validateAll", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const starters = ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"];

    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters,
        bench: ["s-b1-1", "s-b2-1"],
        reserve: ["s-r1-1"],
        rawReserveField: ["s-r1-1", "s-r1-1"],
        rawPlayersField: [...starters, "s-b1-1", "s-b1-1", "s-b2-1", "s-r1-1"],
      }),
    );

    const result = await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const players = ws.readPlayers();
    const weeks = ws.readWeeks();
    const leg3 = weeks.weeks.find((w) => w.leg === 3)!;

    expect(new Set(players.players.map((p) => p.sleeperId)).size).toBe(players.players.length);
    expect(leg3.bench).toEqual(["s-b1-1", "s-b2-1"]);
    expect(leg3.reserve).toEqual(["s-r1-1"]);
    expect(result.updatedWeeks.weeks.find((w) => w.leg === 3)?.reserve).toEqual(["s-r1-1"]);
    expect(
      validateAll(players, ws.readLogs(), weeks, ws.readLocks(), ws.readEspnMap()),
    ).toEqual([]);
  });

  it("T5-4: retained dropped player idempotency (changed === false AND report.hasActionableDiffs === false on subsequent read-only sync)", async () => {
    const syncApplyMod = await import("../../src/sleeper/syncApply.js");
    const starters = ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"];
    const espnScheduleByDate = {
      "2026-11-06": [{ eventId: "e-1106", homeTeam: "NYK", awayTeam: "MIL", isFinal: false }],
    };

    // Drop s-b2-1 (Bam Adebayo, who has a game log on 2026-11-03)
    vi.stubGlobal(
      "fetch",
      buildSleeperMockFetch({
        leg: 3,
        starters,
        bench: ["s-b1-1"],
        reserve: ["s-r1-1"],
        espnScheduleByDate,
      }),
    );

    const firstResult = await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });
    expect(firstResult.changed).toBe(true);
    expect(firstResult.retainedDroppedPlayers.map((p) => p.sleeperId)).toContain("s-b2-1");

    // Subsequent read-only sync with identical Sleeper/ESPN state
    const secondResult = await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: false,
    });

    expect(secondResult.changed).toBe(false);
    expect(secondResult.report.hasActionableDiffs).toBe(false);
    expect(secondResult.report.rosterDiffs.droppedFromSleeper).toEqual([]);
  });

  it("T5-5: Final game with only DNP rostered player clears remainingGames in applyIngestionProposal", async () => {
    // Bam Adebayo (s-b2-1, MIA, espnAthleteId 4066261) has remainingGames ["2026-11-06", "2026-11-08"]
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("scoreboard") && url.includes("dates=20261106")) {
        return new Response(
          JSON.stringify(
            makeEspnScoreboardPayload("2026-11-06", [
              { eventId: "ev-mia-1106", homeTeam: "MIA", awayTeam: "DET", isFinal: true },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-mia-1106")) {
        return new Response(
          JSON.stringify({
            boxscore: {
              players: [
                {
                  team: { abbreviation: "MIA" },
                  statistics: [
                    {
                      labels: ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO"],
                      athletes: [
                        {
                          athlete: { id: "4066261", displayName: "Bam Adebayo" },
                          didNotPlay: true,
                          reason: "Rest",
                          stats: [],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const existingLogs = ws.readLogs();
    const playersFile = ws.readPlayers();
    const weeksFile = ws.readWeeks();
    const espnMap = ws.readEspnMap();

    const report = await runEspnIngestion({
      dates: ["2026-11-06"],
      verifyExisting: false,
      playersFile,
      espnPlayerMap: espnMap,
      existingLogs,
      weeksFile,
      locksFile: ws.readLocks(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(report.proposedLogs).toHaveLength(0);
    expect(report.skipped.some((s) => s.sleeperId === "s-b2-1" && s.reason === "DNP")).toBe(true);

    const { updatedLogs, updatedWeeks, updatedPlayers } = applyIngestionProposal({
      report,
      playersFile,
      existingLogs,
      weeksFile,
      espnPlayerMap: espnMap,
    });

    const leg3 = updatedWeeks.weeks.find((w) => w.leg === 3)!;
    expect(leg3.remainingGames["s-b2-1"]).toEqual(["2026-11-08"]);
    expect(updatedLogs).toHaveLength(existingLogs.length);
    expect(updatedPlayers.asOf).toBe(playersFile.asOf);
  });

  it("T5-6: DST spring-forward / fall-back & UTC-midnight Eastern window boundaries and asOf > today", () => {
    // UTC midnight / late-evening ET: 2026-11-05T02:00:00Z is 2026-11-04 21:00 EST
    const utcLateNight = computeEasternDateWindow(new Date("2026-11-05T02:00:00Z"));
    expect(utcLateNight).toEqual({
      yesterday: "2026-11-03",
      today: "2026-11-04",
      dates: ["2026-11-03", "2026-11-04"],
    });

    // Fall-back DST Sunday (2026-11-01)
    const fallBack = computeEasternDateWindow(new Date("2026-11-01T06:30:00Z"));
    expect(fallBack).toEqual({
      yesterday: "2026-10-31",
      today: "2026-11-01",
      dates: ["2026-10-31", "2026-11-01"],
    });

    // Spring-forward DST Sunday (2026-03-08)
    const springForward = computeEasternDateWindow(new Date("2026-03-08T07:30:00Z"));
    expect(springForward).toEqual({
      yesterday: "2026-03-07",
      today: "2026-03-08",
      dates: ["2026-03-07", "2026-03-08"],
    });

    // Year boundary in ET: 2027-01-01T05:00:00Z is 2027-01-01 00:00 EST
    const newYear = computeEasternDateWindow(new Date("2027-01-01T05:00:00Z"));
    expect(newYear).toEqual({
      yesterday: "2026-12-31",
      today: "2027-01-01",
      dates: ["2026-12-31", "2027-01-01"],
    });

    // asOf > today -> catch-up is no-op
    const futureAsOf = computeCatchUpDates("2026-11-10", new Date("2026-11-05T15:00:00Z"));
    expect(futureAsOf).toEqual({
      dates: [],
      today: "2026-11-05",
      isNoOp: true,
    });
  });

  it("T5-7: multi-day backfill with 2 games in the same leg (EARLIER_IN_LEG vs UNLOCKED_LATEST_IN_LEG) + NO_WEEK date", async () => {
    const bookerLatestTotal = fantasyPoints({
      sleeperId: "s-sg-1",
      date: "2026-11-07",
      opponent: "BOS",
      pts: 25,
      reb: 3,
      ast: 4,
      stl: 1,
      blk: 1,
      tov: 1,
      source: "test",
    }).total;

    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("scoreboard") && url.includes("dates=20261106")) {
        return new Response(
          JSON.stringify(
            makeEspnScoreboardPayload("2026-11-06", [
              { eventId: "ev-phx-1106", homeTeam: "PHX", awayTeam: "SAS", isFinal: true },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("scoreboard") && url.includes("dates=20261107")) {
        return new Response(
          JSON.stringify(
            makeEspnScoreboardPayload("2026-11-07", [
              { eventId: "ev-phx-1107", homeTeam: "PHX", awayTeam: "BOS", isFinal: true },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("scoreboard") && url.includes("dates=20261110")) {
        return new Response(
          JSON.stringify(
            makeEspnScoreboardPayload("2026-11-10", [
              { eventId: "ev-nyk-1110", homeTeam: "NYK", awayTeam: "DET", isFinal: true },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-phx-1106")) {
        return new Response(
          JSON.stringify(
            makeEspnSummaryPayload([
              {
                teamAbbr: "PHX",
                athletes: [
                  { espnAthleteId: "3136193", displayName: "Devin Booker", min: "34:00", pts: 30, reb: 4, ast: 6, stl: 1, blk: 0, tov: 2 },
                ],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-phx-1107")) {
        return new Response(
          JSON.stringify(
            makeEspnSummaryPayload([
              {
                teamAbbr: "PHX",
                athletes: [
                  { espnAthleteId: "3136193", displayName: "Devin Booker", min: "36:00", pts: 25, reb: 3, ast: 4, stl: 1, blk: 1, tov: 1 },
                ],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-nyk-1110")) {
        return new Response(
          JSON.stringify(
            makeEspnSummaryPayload([
              {
                teamAbbr: "NYK",
                athletes: [
                  { espnAthleteId: "3934672", displayName: "Jalen Brunson", min: "35:00", pts: 28, reb: 3, ast: 7, stl: 1, blk: 0, tov: 2 },
                ],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes(`/league/${LEAGUE_ID}/matchups/3`)) {
        return new Response(
          JSON.stringify([
            {
              roster_id: 1,
              matchup_id: 1,
              points: 300,
              players_points: {
                "s-sg-1": bookerLatestTotal,
              },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify([]), { status: 200 });
    };

    const report = await runEspnIngestion({
      dates: ["2026-11-06", "2026-11-07", "2026-11-10"],
      verifyExisting: false,
      playersFile: ws.readPlayers(),
      espnPlayerMap: ws.readEspnMap(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      locksFile: ws.readLocks(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const rec1106 = report.reconciliations.find(
      (r) => r.gameLog.sleeperId === "s-sg-1" && r.gameLog.date === "2026-11-06",
    );
    const rec1107 = report.reconciliations.find(
      (r) => r.gameLog.sleeperId === "s-sg-1" && r.gameLog.date === "2026-11-07",
    );
    const rec1110 = report.reconciliations.find(
      (r) => r.gameLog.sleeperId === "s-pg-1" && r.gameLog.date === "2026-11-10",
    );

    expect(rec1106?.scope).toBe("EARLIER_IN_LEG");
    expect(rec1106?.status).toBe("INFO");
    expect(rec1107?.scope).toBe("UNLOCKED_LATEST_IN_LEG");
    expect(rec1107?.status).toBe("MATCH");
    expect(rec1110?.scope).toBe("NO_WEEK");
    expect(rec1110?.status).toBe("INFO");
    expect(rec1110?.leg).toBeNull();
    expect(report.reconcileFlags).toEqual([]);
    expect(report.hasFailures).toBe(false);
  });

  it("T5-8: malformed ESPN box score (non-numeric stat / missing column header) & validateGameLogs teammate schedule conflict", () => {
    const mapByAthleteId = new Map(
      ws.readEspnMap().players.map((m) => [m.espnAthleteId, m]),
    );
    const event = { eventId: "ev-bad", date: "2026-11-06", homeTeam: "NYK", awayTeam: "MIL" };

    // Non-numeric PTS stat
    const nonNumericPayload = {
      boxscore: {
        players: [
          {
            team: { abbreviation: "NYK" },
            statistics: [
              {
                labels: ["MIN", "REB", "AST", "STL", "BLK", "TO", "PTS"],
                athletes: [
                  {
                    athlete: { id: "3934672", displayName: "Jalen Brunson" },
                    stats: ["34:00", "4", "8", "1", "0", "2", "N/A"],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(() =>
      extractPlayerBoxScoresFromSummary(nonNumericPayload, event, mapByAthleteId),
    ).toThrow(/Invalid PTS stat value/);

    // Missing required column header (missing REB)
    const missingHeaderPayload = {
      boxscore: {
        players: [
          {
            team: { abbreviation: "NYK" },
            statistics: [
              {
                labels: ["MIN", "AST", "STL", "BLK", "TO", "PTS"],
                athletes: [
                  {
                    athlete: { id: "3934672", displayName: "Jalen Brunson" },
                    stats: ["34:00", "8", "1", "0", "2", "30"],
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    expect(() =>
      extractPlayerBoxScoresFromSummary(missingHeaderPayload, event, mapByAthleteId),
    ).toThrow(/missing required stat column headers/);

    // Teammate schedule conflict: Franz Wagner (s-f-1, ORL) & Paolo Banchero (s-r1-1, ORL) on same date with different opponents
    const players = ws.readPlayers();
    const conflictingLogs = [
      ...ws.readLogs(),
      {
        sleeperId: "s-f-1",
        date: "2026-11-06",
        opponent: "CLE",
        pts: 24,
        reb: 6,
        ast: 5,
        stl: 1,
        blk: 0,
        tov: 2,
        source: "test-conflict-1",
      },
      {
        sleeperId: "s-r1-1",
        date: "2026-11-06",
        opponent: "@BOS",
        pts: 26,
        reb: 8,
        ast: 4,
        stl: 1,
        blk: 1,
        tov: 3,
        source: "test-conflict-2",
      },
    ];
    const errors = validateGameLogs(conflictingLogs, players);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("ORL") && e.includes("2026-11-06"))).toBe(true);
  });
});
