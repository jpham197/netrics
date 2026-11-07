// Unit tests for Phase 6 ESPN Box-Score Game-Log Ingestion & Sleeper Reconciliation
// (`docs/design/NETRICS-DESIGN.md` §9 & `docs/decisions/0005-espn-game-log-ingestion.md`).
// Uses realistic ESPN & Sleeper fixture payloads only — never calls live network in tests.

import { describe, expect, it } from "vitest";
import { loadAll } from "../data/load.js";
import type { EspnPlayerMapEntry, GameLog } from "../data/types.js";
import { validateAll } from "../data/validate.js";
import {
  ESPN_NBA_BASE_URL,
  SLEEPER_BASE_URL,
  applyIngestionProposal,
  buildNightlyPrMetadata,
  computeEasternDateWindow,
  extractEventsFromScoreboard,
  extractPlayerBoxScoresFromSummary,
  formatIngestionReport,
  normalizeEspnTeam,
  parseMinutes,
  reconcileAndBuildReport,
  runEspnIngestion,
  validateSafeOutPath,
} from "./ingest.js";
import { parseIngestCliArgs, resolvePathSafe } from "./ingest-cli.js";


const STANDARD_ESPN_LABELS = [
  "MIN",
  "FG",
  "3PT",
  "FT",
  "OREB",
  "DREB",
  "REB",
  "AST",
  "STL",
  "BLK",
  "TO",
  "PF",
  "+/-",
  "PTS",
];

describe("normalizeEspnTeam & parseMinutes", () => {
  it("normalizes ESPN non-standard team abbreviations to canonical 3-letter NBA codes", () => {
    expect(normalizeEspnTeam("GS")).toBe("GSW");
    expect(normalizeEspnTeam("NY")).toBe("NYK");
    expect(normalizeEspnTeam("NO")).toBe("NOP");
    expect(normalizeEspnTeam("SA")).toBe("SAS");
    expect(normalizeEspnTeam("UTAH")).toBe("UTA");
    expect(normalizeEspnTeam("WSH")).toBe("WAS");
    expect(normalizeEspnTeam(" wsh ")).toBe("WAS");
    expect(normalizeEspnTeam("LAL")).toBe("LAL");
    expect(normalizeEspnTeam("POR")).toBe("POR");
  });

  it("parses integer and MM:SS minutes strings and returns 0 for DNP/zero/empty values", () => {
    expect(parseMinutes("34")).toBe(34);
    expect(parseMinutes("34:12")).toBeCloseTo(34.2, 5);
    expect(parseMinutes("0:45")).toBeCloseTo(0.75, 5);
    expect(parseMinutes("1:00")).toBe(1);
    expect(parseMinutes("0")).toBe(0);
    expect(parseMinutes("0:00")).toBe(0);
    expect(parseMinutes("--")).toBe(0);
    expect(parseMinutes("")).toBe(0);
    expect(parseMinutes(undefined)).toBe(0);
  });
});

describe("extractEventsFromScoreboard", () => {
  const rosterTeams = new Set(["LAL", "POR", "WAS", "SAC"]);

  it("filters to games involving roster teams, normalizes abbreviations, and flags Final vs non-Final games", () => {
    const scoreboardFixture = {
      day: { date: "2026-11-06" },
      events: [
        {
          id: "401809991",
          date: "2026-11-07T02:30Z", // 9:30 PM ET on 2026-11-06
          status: { type: { completed: true, description: "Final", name: "STATUS_FINAL" } },
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: { abbreviation: "LAL" } },
                { homeAway: "away", team: { abbreviation: "POR" } },
              ],
            },
          ],
        },
        {
          id: "401809992",
          date: "2026-11-06T23:30Z",
          status: { type: { completed: true, description: "Final", name: "STATUS_FINAL" } },
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: { abbreviation: "ATL" } },
                { homeAway: "away", team: { abbreviation: "WSH" } }, // normalized -> WAS
              ],
            },
          ],
        },
        {
          id: "401809993",
          date: "2026-11-07T03:00Z",
          status: { type: { completed: false, description: "In Progress", name: "STATUS_IN_PROGRESS" } },
          competitions: [
            {
              competitors: [
                { homeAway: "home", team: { abbreviation: "SAC" } },
                { homeAway: "away", team: { abbreviation: "SA" } }, // normalized -> SAS
              ],
            },
          ],
        },
        {
          id: "401809999",
          date: "2026-11-06T23:00Z",
          status: { type: { completed: true, description: "Final" } },
          competitions: [
            {
              // Neither CLE nor CHI is in rosterTeams -> filtered out
              competitors: [
                { homeAway: "home", team: { abbreviation: "CLE" } },
                { homeAway: "away", team: { abbreviation: "CHI" } },
              ],
            },
          ],
        },
      ],
    };

    const games = extractEventsFromScoreboard(scoreboardFixture, rosterTeams, "2026-11-06");
    expect(games).toEqual([
      {
        eventId: "401809991",
        date: "2026-11-06",
        homeTeam: "LAL",
        awayTeam: "POR",
        statusDescription: "Final",
        isFinal: true,
      },
      {
        eventId: "401809992",
        date: "2026-11-06",
        homeTeam: "ATL",
        awayTeam: "WAS",
        statusDescription: "Final",
        isFinal: true,
      },
      {
        eventId: "401809993",
        date: "2026-11-06",
        homeTeam: "SAC",
        awayTeam: "SAS",
        statusDescription: "In Progress",
        isFinal: false,
      },
    ]);
  });
});

describe("extractPlayerBoxScoresFromSummary & reconcileAndBuildReport", () => {
  const { players, logs: allLogs, weeks, locks, espnPlayerMap } = loadAll();
  const logs = allLogs.filter((l) => l.date <= "2026-11-06");
  const mapByAthleteId = new Map<string, EspnPlayerMapEntry>(
    espnPlayerMap.players.map((entry) => [entry.espnAthleteId, entry]),
  );


  it("extracts Walker Kessler (2441, LAL vs POR on 2026-11-06) and reconciles cleanly (MATCH) against Sleeper 38.00", () => {
    const summaryFixture = {
      boxscore: {
        players: [
          {
            team: { abbreviation: "LAL" },
            statistics: [
              {
                labels: STANDARD_ESPN_LABELS,
                athletes: [
                  {
                    athlete: { id: "4433136", displayName: "Walker Kessler" },
                    didNotPlay: false,
                    stats: [
                      "31:45", // MIN
                      "7-9",   // FG
                      "0-0",   // 3PT
                      "2-2",   // FT
                      "4",     // OREB
                      "8",     // DREB
                      "12",    // REB
                      "2",     // AST
                      "1",     // STL
                      "0",     // BLK
                      "1",     // TO
                      "3",     // PF
                      "+8",    // +/-
                      "16",    // PTS
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const { extracted, skippedDnp } = extractPlayerBoxScoresFromSummary(
      summaryFixture,
      { eventId: "401809991", date: "2026-11-06", homeTeam: "LAL", awayTeam: "POR" },
      mapByAthleteId,
    );

    expect(skippedDnp).toEqual([]);
    expect(extracted.length).toBe(1);
    const kessler = extracted[0]!;
    expect(kessler.gameLog).toEqual({
      sleeperId: "2441",
      date: "2026-11-06",
      opponent: "POR",
      pts: 16,
      reb: 12,
      ast: 2,
      stl: 1,
      blk: 0,
      tov: 1,
      expectedTotal: 38,
      source: "ESPN box score 401809991 2026-11-06 POR @ LAL (16/12/2, 1 stl, 0 blk, 1 tov)",
    });

    // Reconcile in forward mode (with Nov 6 log omitted from existingLogs so it is proposed)
    const priorLogs = logs.filter((l) => !(l.sleeperId === "2441" && l.date === "2026-11-06"));
    const report = reconcileAndBuildReport({
      dates: ["2026-11-06"],
      candidates: extracted,
      existingLogs: priorLogs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "2441": 38.0 },
    });

    expect(report.hasFailures).toBe(false);
    expect(report.reconcileFlags).toEqual([]);
    expect(report.proposedLogs).toHaveLength(1);
    expect(report.reconciliations[0]).toMatchObject({
      playerName: "Walker Kessler",
      computedTotal: 38,
      sleeperTotal: 38,
      diff: 0,
      leg: 3,
      scope: "UNLOCKED_LATEST_IN_LEG",
      status: "MATCH",
    });
  });

  it("flags Domantas Sabonis (1739, SAC on 2026-11-06) when ESPN box score computes 37.50 vs Sleeper 35.50 (+2.00 Flagrant 1 foul discrepancy)", () => {
    const sabonisSummary = {
      boxscore: {
        players: [
          {
            team: { abbreviation: "SAC" },
            statistics: [
              {
                // Reordered columns to prove header-driven lookup
                labels: ["MIN", "PTS", "REB", "AST", "STL", "BLK", "TOV", "PF"],
                athletes: [
                  {
                    athlete: { id: "3155942", displayName: "Domantas Sabonis" },
                    stats: ["35:10", "22", "10", "2", "0", "0", "2", "4"],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const { extracted } = extractPlayerBoxScoresFromSummary(
      sabonisSummary,
      { eventId: "401809994", date: "2026-11-06", homeTeam: "SAC", awayTeam: "CHA" },
      mapByAthleteId,
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.gameLog.expectedTotal).toBe(37.5);
    expect(extracted[0]!.gameLog.ff).toBeUndefined();
    expect(extracted[0]!.gameLog.tf).toBeUndefined();

    const priorLogs = logs.filter((l) => !(l.sleeperId === "1739" && l.date === "2026-11-06"));
    const report = reconcileAndBuildReport({
      dates: ["2026-11-06"],
      candidates: extracted,
      existingLogs: priorLogs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "1739": 35.5 },
    });

    expect(report.hasFailures).toBe(true);
    expect(report.reconcileFlags).toEqual([
      "RECONCILE: Domantas Sabonis (1739) 2026-11-06 computed 37.50 vs Sleeper 35.50 (diff +2.00)",
    ]);
    expect(report.reconciliations[0]).toMatchObject({
      computedTotal: 37.5,
      sleeperTotal: 35.5,
      diff: 2,
      scope: "UNLOCKED_LATEST_IN_LEG",
      status: "RECONCILE",
    });
  });

  it("normalizes WSH -> WAS for Kyshawn George (2714, WAS @ ATL on 2026-11-06 -> 57.00) and supports --verify-existing (VERIFIED vs VERIFY_DIFF)", () => {
    const kyshawnSummary = {
      boxscore: {
        players: [
          {
            team: { abbreviation: "WSH" },
            statistics: [
              {
                labels: STANDARD_ESPN_LABELS,
                athletes: [
                  {
                    athlete: { id: "5174563", displayName: "Kyshawn George" },
                    stats: [
                      "36:00",
                      "12-20",
                      "5-9",
                      "4-4",
                      "1",
                      "3",
                      "4",  // REB
                      "8",  // AST
                      "1",  // STL
                      "2",  // BLK
                      "2",  // TO
                      "2",
                      "+11",
                      "33", // PTS
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const { extracted } = extractPlayerBoxScoresFromSummary(
      kyshawnSummary,
      { eventId: "401809992", date: "2026-11-06", homeTeam: "ATL", awayTeam: "WSH" },
      mapByAthleteId,
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.gameLog).toEqual({
      sleeperId: "2714",
      date: "2026-11-06",
      opponent: "@ATL",
      pts: 33,
      reb: 4,
      ast: 8,
      stl: 1,
      blk: 2,
      tov: 2,
      expectedTotal: 57,
      source: "ESPN box score 401809992 2026-11-06 WAS @ ATL (33/4/8, 1 stl, 2 blk, 2 tov)",
    });

    // 1. Forward mode when not yet in existingLogs -> MATCH against Sleeper 57.00
    const withoutNov6 = logs.filter((l) => !(l.sleeperId === "2714" && l.date === "2026-11-06"));
    const forwardReport = reconcileAndBuildReport({
      dates: ["2026-11-06"],
      candidates: extracted,
      existingLogs: withoutNov6,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "2714": 57.0 },
    });
    expect(forwardReport.hasFailures).toBe(false);
    expect(forwardReport.reconciliations[0]?.status).toBe("MATCH");

    // 2. --verify-existing against the real committed seed log (8 ast) -> VERIFIED
    const verifyCleanReport = reconcileAndBuildReport({
      dates: ["2026-11-06"],
      verifyExisting: true,
      candidates: extracted,
      existingLogs: logs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
    });
    expect(verifyCleanReport.hasFailures).toBe(false);
    expect(verifyCleanReport.verifiedExisting).toHaveLength(1);
    expect(verifyCleanReport.verifiedExisting[0]?.status).toBe("VERIFIED");

    // 3. --verify-existing against a mutated 7-assist seed log -> VERIFY_DIFF flag
    const mutatedLogs: GameLog[] = logs.map((l) =>
      l.sleeperId === "2714" && l.date === "2026-11-06"
        ? { ...l, ast: 7, expectedTotal: 55.5 }
        : l,
    );
    const verifyDiffReport = reconcileAndBuildReport({
      dates: ["2026-11-06"],
      verifyExisting: true,
      candidates: extracted,
      existingLogs: mutatedLogs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
    });
    expect(verifyDiffReport.hasFailures).toBe(true);
    expect(verifyDiffReport.verifiedExisting[0]?.status).toBe("VERIFY_DIFF");
    expect(verifyDiffReport.verifyDiffFlags[0]).toContain("VERIFY_DIFF: Kyshawn George (2714) 2026-11-06");
    expect(verifyDiffReport.verifyDiffFlags[0]).toContain("ast: committed 7 vs ESPN 8");
  });

  it("treats locked players and earlier-in-leg games as informational (INFO) without raising a RECONCILE failure", () => {
    // Deni Avdija (2181) is LOCKED in Leg 3 at Nov 4 (46.75), while his Nov 6 game scored 49.75
    // Walker Kessler (2441) is UNLOCKED in Leg 3, and Nov 4 (46.00) is EARLIER_IN_LEG when Nov 6 (38.00) is present
    const avdijaNov6Candidate = {
      sleeperId: "2181",
      espnAthleteId: "4683021",
      playerName: "Deni Avdija",
      team: "POR",
      eventId: "401809991",
      date: "2026-11-06",
      minutes: 34,
      gameLog: {
        sleeperId: "2181",
        date: "2026-11-06",
        opponent: "@LAL",
        pts: 22,
        reb: 9,
        ast: 11,
        stl: 2,
        blk: 0,
        tov: 8,
        expectedTotal: 49.75,
        source: "ESPN box score 401809991 2026-11-06 POR @ LAL (22/9/11, 2 stl, 0 blk, 8 tov)",
      },
    };

    const kesslerNov4Candidate = {
      sleeperId: "2441",
      espnAthleteId: "4433136",
      playerName: "Walker Kessler",
      team: "LAL",
      eventId: "401809950",
      date: "2026-11-04",
      minutes: 30,
      gameLog: {
        sleeperId: "2441",
        date: "2026-11-04",
        opponent: "@SAC",
        pts: 15,
        reb: 8,
        ast: 0,
        stl: 3,
        blk: 4,
        tov: 0,
        expectedTotal: 46,
        source: "ESPN box score 401809950 2026-11-04 LAL @ SAC (15/8/0, 3 stl, 4 blk, 0 tov)",
      },
    };

    // Existing logs have Kessler's later Nov 6 game (38.00), but omit Avdija Nov 6 and Kessler Nov 4
    const subsetLogs = logs.filter(
      (l) =>
        !(l.sleeperId === "2181" && l.date === "2026-11-06") &&
        !(l.sleeperId === "2441" && l.date === "2026-11-04"),
    );

    const report = reconcileAndBuildReport({
      dates: ["2026-11-04", "2026-11-06"],
      candidates: [avdijaNov6Candidate, kesslerNov4Candidate],
      existingLogs: subsetLogs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: {
        "2181": 46.75, // Locked at Nov 4
        "2441": 38.0,  // Latest game in Leg 3 is Nov 6
      },
    });

    expect(report.hasFailures).toBe(false);
    expect(report.reconcileFlags).toEqual([]);
    expect(report.reconciliations).toHaveLength(2);
    expect(report.reconciliations[0]).toMatchObject({
      playerName: "Deni Avdija",
      computedTotal: 49.75,
      sleeperTotal: 46.75,
      scope: "LOCKED",
      status: "INFO",
    });
    expect(report.reconciliations[1]).toMatchObject({
      playerName: "Walker Kessler",
      computedTotal: 46,
      sleeperTotal: 38,
      scope: "EARLIER_IN_LEG",
      status: "INFO",
    });
  });

  it("skips DNP / 0-minute appearances as DNP, logs a 1-minute 0.00 appearance as a valid GameLog, and skips non-Final games", () => {
    const summaryWithDnpAndZeroScore = {
      boxscore: {
        players: [
          {
            team: { abbreviation: "SAC" },
            statistics: [
              {
                labels: STANDARD_ESPN_LABELS,
                athletes: [
                  {
                    // Keegan Murray (2456) DNP
                    athlete: { id: "4594327", displayName: "Keegan Murray" },
                    didNotPlay: true,
                    reason: "DNP - Injury/Illness",
                    stats: [],
                  },
                ],
              },
            ],
          },
          {
            team: { abbreviation: "BKN" },
            statistics: [
              {
                labels: STANDARD_ESPN_LABELS,
                athletes: [
                  {
                    // Nolan Traore (4742) played 1:00 with 0 stats -> valid 0.00 GameLog
                    athlete: { id: "5279130", displayName: "Nolan Traore" },
                    didNotPlay: false,
                    stats: ["1:00", "0-1", "0-1", "0-0", "0", "0", "0", "0", "0", "0", "0", "0", "-2", "0"],
                  },
                ],
              },
            ],
          },
          {
            team: { abbreviation: "CHA" },
            statistics: [
              {
                labels: STANDARD_ESPN_LABELS,
                athletes: [
                  {
                    // Coby White (1998) active row with 0:00 minutes -> skipped as DNP
                    athlete: { id: "4395651", displayName: "Coby White" },
                    didNotPlay: false,
                    stats: ["0:00", "0-0", "0-0", "0-0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const { extracted, skippedDnp } = extractPlayerBoxScoresFromSummary(
      summaryWithDnpAndZeroScore,
      { eventId: "401809998", date: "2026-11-07", homeTeam: "SAC", awayTeam: "BKN" },
      mapByAthleteId,
    );

    expect(extracted).toHaveLength(1);
    expect(extracted[0]!.gameLog).toEqual({
      sleeperId: "4742",
      date: "2026-11-07",
      opponent: "@SAC",
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      expectedTotal: 0,
      source: "ESPN box score 401809998 2026-11-07 BKN @ SAC (0/0/0, 0 stl, 0 blk, 0 tov)",
    });

    expect(skippedDnp).toHaveLength(2);
    expect(skippedDnp.map((s) => ({ sleeperId: s.sleeperId, reason: s.reason }))).toEqual([
      { sleeperId: "2456", reason: "DNP" },
      { sleeperId: "1998", reason: "DNP" },
    ]);

    const report = reconcileAndBuildReport({
      dates: ["2026-11-07"],
      discoveredGames: [
        {
          eventId: "401809998",
          date: "2026-11-07",
          homeTeam: "SAC",
          awayTeam: "BKN",
          statusDescription: "Final",
          isFinal: true,
        },
        {
          eventId: "401809999",
          date: "2026-11-07",
          homeTeam: "OKC",
          awayTeam: "POR",
          statusDescription: "Scheduled",
          isFinal: false,
        },
      ],
      candidates: extracted,
      skippedDnp,
      existingLogs: logs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "4742": 0 },
    });

    expect(report.hasFailures).toBe(false);
    expect(report.skipped.some((s) => s.reason === "not Final" && s.eventId === "401809999")).toBe(true);
    expect(report.skipped.filter((s) => s.reason === "DNP")).toHaveLength(2);

    const formatted = formatIngestionReport(report);
    expect(formatted).toContain("=== Netrics ESPN Game-Log Ingestion Report ===");
    expect(formatted).toContain("Nolan Traore (4742)");
    expect(formatted).toContain("SKIP [not Final]");
    expect(formatted).toContain("SKIP [DNP]");
  });
});

describe("validateSafeOutPath & parseIngestCliArgs", () => {
  const repoRoot = "/home/antigravity/jpham197/netrics";

  it("allows output paths outside data/ and rejects any path resolving inside data/", () => {
    expect(validateSafeOutPath("/tmp/proposed.json", repoRoot)).toBe("/tmp/proposed.json");
    expect(validateSafeOutPath("./ingest-proposal-2026-11-07.json", repoRoot)).toBe(
      "/home/antigravity/jpham197/netrics/ingest-proposal-2026-11-07.json",
    );

    expect(() => validateSafeOutPath("data/game-logs.json", repoRoot)).toThrow(/inside data\/ are forbidden/);
    expect(() => validateSafeOutPath("./data/anything.json", repoRoot)).toThrow(/inside data\/ are forbidden/);
    expect(() => validateSafeOutPath("data", repoRoot)).toThrow(/inside data\/ are forbidden/);
    expect(() => validateSafeOutPath("src/../data/locks.json", repoRoot)).toThrow(/inside data\/ are forbidden/);
  });

  it("parses CLI flags (--date, --window-eastern, --verify-existing, --out, --allow-reconcile-flags, --apply-to-data, --pr-meta-out) and rejects missing/invalid flags", () => {
    const parsed = parseIngestCliArgs(
      ["--date", "2026-11-06", "--date=2026-11-07", "--verify-existing", "--out", "/tmp/out.json"],
      repoRoot,
    );
    expect(parsed).toEqual({
      dates: ["2026-11-06", "2026-11-07"],
      verifyExisting: true,
      outPath: "/tmp/out.json",
      windowEastern: false,
      allowReconcileFlags: false,
      applyToData: false,
      prMetaOutPath: null,
    });

    const parsedNightly = parseIngestCliArgs(
      [
        "--window-eastern",
        "--allow-reconcile-flags",
        "--apply-to-data",
        "--pr-meta-out",
        "/tmp/ingest-pr-meta.json",
      ],
      repoRoot,
      new Date("2026-11-08T05:00:00Z"), // 00:00 EST on 2026-11-08
    );
    expect(parsedNightly).toEqual({
      dates: ["2026-11-07", "2026-11-08"],
      verifyExisting: false,
      outPath: null,
      windowEastern: true,
      allowReconcileFlags: true,
      applyToData: true,
      prMetaOutPath: "/tmp/ingest-pr-meta.json",
    });

    expect(() => parseIngestCliArgs([], repoRoot)).toThrow(/At least one --date/);
    expect(() => parseIngestCliArgs(["--date", "2026-02-31"], repoRoot)).toThrow(/Invalid or missing --date/);
    expect(() => parseIngestCliArgs(["--date", "2026-11-06", "--out", "data/game-logs.json"], repoRoot)).toThrow(
      /inside data\/ are forbidden/,
    );
    expect(() =>
      parseIngestCliArgs(["--window-eastern", "--pr-meta-out=data/meta.json"], repoRoot),
    ).toThrow(/inside data\/ are forbidden/);
    expect(resolvePathSafe("dist/espn/ingest-cli.js")).toBe(
      resolvePathSafe(`${process.cwd()}/dist/espn/ingest-cli.js`),
    );
  });

  it("raises a RECONCILE flag when an unlocked latest-in-leg player is missing from Sleeper players_points", () => {
    const { players, logs: allLogs, weeks, locks } = loadAll();
    const logs = allLogs.filter((l) => l.date <= "2026-11-06");
    const report = reconcileAndBuildReport({
      dates: ["2026-11-07"],
      candidates: [
        {
          sleeperId: "2713",
          espnAthleteId: "4683778",
          playerName: "Jared McCain",
          team: "OKC",
          eventId: "401810001",
          date: "2026-11-07",
          minutes: 25,
          gameLog: {
            sleeperId: "2713",
            date: "2026-11-07",
            opponent: "POR",
            pts: 20,
            reb: 2,
            ast: 2,
            stl: 1,
            blk: 0,
            tov: 0,
            expectedTotal: 28.5,
            source: "ESPN box score 401810001 2026-11-07 POR @ OKC (20/2/2, 1 stl, 0 blk, 0 tov)",
          },
        },
      ],
      existingLogs: logs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "2441": 38.0 }, // Leg 3 data present, but 2713 missing
    });

    expect(report.hasFailures).toBe(true);
    expect(report.reconcileFlags[0]).toContain(
      "RECONCILE: Jared McCain (2713) 2026-11-07 computed 28.50 vs Sleeper missing",
    );
  });
});

describe("runEspnIngestion — end-to-end with mocked fetchImpl", () => {
  const { players, logs: allLogs, weeks, locks, espnPlayerMap } = loadAll();
  const logs = allLogs.filter((l) => l.date <= "2026-11-06");

  it("fetches scoreboard, summary, and Sleeper leg matchups via injected fetchImpl without live network calls", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url === `${ESPN_NBA_BASE_URL}/scoreboard?dates=20261107`) {
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "401810001",
                date: "2026-11-07",
                status: { type: { completed: true, description: "Final" } },
                competitions: [
                  {
                    competitors: [
                      { homeAway: "home", team: { abbreviation: "OKC" } },
                      { homeAway: "away", team: { abbreviation: "POR" } },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url === `${ESPN_NBA_BASE_URL}/summary?event=401810001`) {
        return new Response(
          JSON.stringify({
            boxscore: {
              players: [
                {
                  team: { abbreviation: "OKC" },
                  statistics: [
                    {
                      labels: STANDARD_ESPN_LABELS,
                      athletes: [
                        {
                          athlete: { id: "4683778", displayName: "Jared McCain" },
                          stats: ["29:15", "8-14", "4-8", "2-2", "1", "3", "4", "4", "1", "0", "1", "2", "+5", "22"],
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
      if (url === `${SLEEPER_BASE_URL}/league/${players.leagueId}/matchups/3`) {
        // McCain: 22*1 + 4*1.25 + 4*1.5 + 1*3 - 1*1 = 22 + 5 + 6 + 3 - 1 = 35.00
        return new Response(
          JSON.stringify([
            {
              roster_id: 1,
              matchup_id: 4,
              points: 401.0,
              players_points: { "2713": 35.0 },
            },
          ]),
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const report = await runEspnIngestion({
      dates: ["2026-11-07"],
      playersFile: players,
      espnPlayerMap,
      existingLogs: logs,
      weeksFile: weeks,
      locksFile: locks,
      fetchImpl: mockFetch,
    });

    expect(report.hasFailures).toBe(false);
    expect(report.proposedLogs).toHaveLength(1);
    expect(report.proposedLogs[0]).toMatchObject({
      sleeperId: "2713",
      date: "2026-11-07",
      opponent: "POR",
      pts: 22,
      reb: 4,
      ast: 4,
      stl: 1,
      blk: 0,
      tov: 1,
      expectedTotal: 35,
    });
    expect(report.reconciliations[0]?.status).toBe("MATCH");
  });
});

describe("Phase 6d — computeEasternDateWindow, applyIngestionProposal, and buildNightlyPrMetadata", () => {
  it("computes [yesterday, today] in America/New_York across UTC midnight, DST transitions, and year boundaries", () => {
    // 05:00 UTC on 2026-11-08 is 00:00 EST on 2026-11-08
    expect(computeEasternDateWindow(new Date("2026-11-08T05:00:00Z"))).toEqual({
      yesterday: "2026-11-07",
      today: "2026-11-08",
      dates: ["2026-11-07", "2026-11-08"],
    });

    // 03:30 UTC on 2026-11-08 is still 22:30 EST on 2026-11-07
    expect(computeEasternDateWindow(new Date("2026-11-08T03:30:00Z"))).toEqual({
      yesterday: "2026-11-06",
      today: "2026-11-07",
      dates: ["2026-11-06", "2026-11-07"],
    });

    // US DST fallback day (2026-11-01) and New Year's Day (2027-01-01)
    expect(computeEasternDateWindow(new Date("2026-11-01T12:00:00Z"))).toEqual({
      yesterday: "2026-10-31",
      today: "2026-11-01",
      dates: ["2026-10-31", "2026-11-01"],
    });
    expect(computeEasternDateWindow(new Date("2027-01-01T05:00:00Z"))).toEqual({
      yesterday: "2026-12-31",
      today: "2027-01-01",
      dates: ["2026-12-31", "2027-01-01"],
    });
  });

  it("applies a simulated 2026-11-07 Final game log for Walker Kessler (2441) onto real repository data/*.json and passes validateAll with zero errors", () => {
    const { players, logs, weeks, locks, espnPlayerMap } = loadAll();

    // Ensure 2026-11-07 is in Kessler's remainingGames before applying so we also verify removal
    const weeksWithNov7 = structuredClone(weeks);
    const leg3 = weeksWithNov7.weeks[0]!;
    leg3.remainingGames["2441"] = ["2026-11-07", "2026-11-08"];

    const kesslerNov7Log: GameLog = {
      sleeperId: "2441",
      date: "2026-11-07",
      opponent: "@GSW",
      pts: 18,
      reb: 14,
      ast: 2,
      stl: 1,
      blk: 3,
      tov: 1,
      expectedTotal: 51.5,
      source: "ESPN box score 401810055 2026-11-07 LAL @ GSW (18/14/2, 1 stl, 3 blk, 1 tov)",
    };

    const report = reconcileAndBuildReport({
      dates: ["2026-11-07"],
      discoveredGames: [
        {
          eventId: "401810055",
          date: "2026-11-07",
          homeTeam: "GSW",
          awayTeam: "LAL",
          statusDescription: "Final",
          isFinal: true,
        },
      ],
      candidates: [
        {
          sleeperId: "2441",
          espnAthleteId: "4433136",
          playerName: "Walker Kessler",
          team: "LAL",
          eventId: "401810055",
          date: "2026-11-07",
          minutes: 33,
          gameLog: kesslerNov7Log,
        },
      ],
      existingLogs: logs,
      weeksFile: weeksWithNov7,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "2441": 51.5 },
    });

    const { updatedLogs, updatedWeeks, updatedPlayers } = applyIngestionProposal({
      report,
      playersFile: players,
      existingLogs: logs,
      weeksFile: weeksWithNov7,
      espnPlayerMap,
    });

    expect(updatedLogs.length).toBe(logs.length + 1);
    expect(updatedWeeks.weeks[0]?.remainingGames["2441"]).toEqual(["2026-11-08"]);
    expect(updatedPlayers.asOf).toBe("2026-11-07");

    const validationErrors = validateAll(
      updatedPlayers,
      updatedLogs,
      updatedWeeks,
      locks,
      espnPlayerMap,
    );
    expect(validationErrors).toEqual([]);
  });

  it("removes completed game date for DNP teammates on the same NBA team (e.g. NOP 4750 + 2131 on 2026-11-08) and advances players.asOf", () => {
    const { players, logs, weeks, locks, espnPlayerMap } = loadAll();

    // Jeremiah Fears (4750, NOP) plays on 2026-11-08 while teammate Saddiq Bey (2131, NOP) is DNP
    const fearsNov8Log: GameLog = {
      sleeperId: "4750",
      date: "2026-11-08",
      opponent: "ORL",
      pts: 24,
      reb: 4,
      ast: 6,
      stl: 2,
      blk: 0,
      tov: 2,
      expectedTotal: 42,
      source: "ESPN box score 401810088 2026-11-08 ORL @ NOP (24/4/6, 2 stl, 0 blk, 2 tov)",
    };

    const report = reconcileAndBuildReport({
      dates: ["2026-11-07", "2026-11-08"],
      candidates: [
        {
          sleeperId: "4750",
          espnAthleteId: "5144091",
          playerName: "Jeremiah Fears",
          team: "NOP",
          eventId: "401810088",
          date: "2026-11-08",
          minutes: 31,
          gameLog: fearsNov8Log,
        },
      ],
      skippedDnp: [
        {
          date: "2026-11-08",
          eventId: "401810088",
          sleeperId: "2131",
          playerName: "Saddiq Bey",
          matchup: "ORL @ NOP",
          reason: "DNP",
          detail: "DNP - Coach's Decision",
        },
      ],
      existingLogs: logs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "4750": 41.75 }, // locked in Leg 3
    });

    const { updatedLogs, updatedWeeks, updatedPlayers } = applyIngestionProposal({
      report,
      playersFile: players,
      existingLogs: logs,
      weeksFile: weeks,
      espnPlayerMap,
    });

    // Both NOP teammates (4750 and 2131) have 2026-11-08 removed from remainingGames
    expect(updatedWeeks.weeks[0]?.remainingGames["4750"]).toEqual([]);
    expect(updatedWeeks.weeks[0]?.remainingGames["2131"]).toEqual([]);
    expect(updatedPlayers.asOf).toBe("2026-11-08");
    expect(validateAll(updatedPlayers, updatedLogs, updatedWeeks, locks, espnPlayerMap)).toEqual([]);
  });

  it("returns untouched clones when report.proposedLogs is empty", () => {
    const { players, logs, weeks, locks } = loadAll();
    const emptyReport = reconcileAndBuildReport({
      dates: ["2026-11-08"],
      candidates: [],
      existingLogs: logs,
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
    });

    const { updatedLogs, updatedWeeks, updatedPlayers } = applyIngestionProposal({
      report: emptyReport,
      playersFile: players,
      existingLogs: logs,
      weeksFile: weeks,
    });

    expect(updatedLogs).toEqual(logs);
    expect(updatedLogs).not.toBe(logs);
    expect(updatedWeeks).toEqual(weeks);
    expect(updatedWeeks).not.toBe(weeks);
    expect(updatedPlayers).toEqual(players);
    expect(updatedPlayers).not.toBe(players);
  });

  it("builds nightly PR metadata with clean title or ⚠ reconcile warning banner and summary sections", () => {
    const { players, logs, weeks, locks } = loadAll();
    const mccainNov7Log: GameLog = {
      sleeperId: "2713",
      date: "2026-11-07",
      opponent: "POR",
      pts: 22,
      reb: 4,
      ast: 4,
      stl: 1,
      blk: 0,
      tov: 1,
      expectedTotal: 35,
      source: "ESPN box score 401810001 2026-11-07 POR @ OKC (22/4/4, 1 stl, 0 blk, 1 tov)",
    };

    const cleanReport = reconcileAndBuildReport({
      dates: ["2026-11-06", "2026-11-07"],
      discoveredGames: [
        {
          eventId: "401810001",
          date: "2026-11-07",
          homeTeam: "OKC",
          awayTeam: "POR",
          statusDescription: "Final",
          isFinal: true,
        },
      ],
      candidates: [
        {
          sleeperId: "2713",
          espnAthleteId: "4683778",
          playerName: "Jared McCain",
          team: "OKC",
          eventId: "401810001",
          date: "2026-11-07",
          minutes: 29,
          gameLog: mccainNov7Log,
        },
      ],
      existingLogs: logs.filter((l) => l.date <= "2026-11-06"),
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "2713": 35.0 },
    });

    const cleanMeta = buildNightlyPrMetadata(cleanReport);
    expect(cleanMeta.branchName).toBe("ingest/2026-11-07");
    expect(cleanMeta.hasReconcileFlags).toBe(false);
    expect(cleanMeta.title).toBe("data: ingest game logs for 2026-11-07");
    expect(cleanMeta.body).not.toContain("## ⚠ Reconciliation Flags");
    expect(cleanMeta.body).toContain("## Proposed Game Logs (1)");
    expect(cleanMeta.body).toContain("Jared McCain");
    expect(cleanMeta.body).toContain("`22/4/4/1/0/1`");
    expect(cleanMeta.body).toContain("**35.00**");
    expect(cleanMeta.body).toContain("## Date Summary");
    expect(cleanMeta.body).toContain("**datesRequested:** 2026-11-06, 2026-11-07");

    // Reconcile mismatch (e.g., Flagrant 1 foul discrepancy)
    const reconcileReport = reconcileAndBuildReport({
      dates: ["2026-11-06", "2026-11-07"],
      candidates: [
        {
          sleeperId: "2713",
          espnAthleteId: "4683778",
          playerName: "Jared McCain",
          team: "OKC",
          eventId: "401810001",
          date: "2026-11-07",
          minutes: 29,
          gameLog: mccainNov7Log,
        },
      ],
      existingLogs: logs.filter((l) => l.date <= "2026-11-06"),
      weeksFile: weeks,
      locksFile: locks,
      playersFile: players,
      sleeperPlayersPoints: { "2713": 33.0 },
    });

    const reconcileMeta = buildNightlyPrMetadata(reconcileReport);
    expect(reconcileMeta.branchName).toBe("ingest/2026-11-07");
    expect(reconcileMeta.hasReconcileFlags).toBe(true);
    expect(reconcileMeta.title).toBe("data: ingest game logs for 2026-11-07 (⚠ reconcile)");
    expect(reconcileMeta.body.startsWith("## ⚠ Reconciliation Flags")).toBe(true);
    expect(reconcileMeta.body).toContain(
      "- [RECONCILE] Jared McCain (2713) 2026-11-07 computed 35.00 vs Sleeper 33.00 (diff +2.00)",
    );
    expect(() =>
      parseIngestCliArgs(["--date", "2026-11-07", "--verify-existing", "--apply-to-data"]),
    ).toThrow(/Cannot combine --verify-existing/);
  });
});

