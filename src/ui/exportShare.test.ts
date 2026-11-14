// @vitest-environment jsdom
// Unit tests for exportShare.ts — ADR-0008.

import { afterEach, describe, expect, it, vi } from "vitest";
import { adviseWeek, evaluateBenchSwings, evaluateMatchup } from "../advisor/index.js";
import { analyzePlayer, scoreLogs } from "../analytics/index.js";
import { loadAll } from "../data/load.js";
import type { GameLog, Player, WeekRecord } from "../data/types.js";
import {
  buildPlayerLogsCsv,
  buildRosterCsv,
  copyToClipboard,
  downloadCsv,
  formatLockAdvisorSummary,
  formatMatchupSummary,
  formatPlayerSummary,
} from "./exportShare.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportShare formatters & CSV builders", () => {
  const { players, logs: allLogs, weeks, locks } = loadAll();
  const logs = allLogs.filter((l) => l.date <= "2026-11-06");
  const leg3 = weeks.weeks[0] as WeekRecord;

  it("formatLockAdvisorSummary formats Leg 3 starters and never includes mean", () => {
    const rows = adviseWeek(leg3, players.players, logs, locks.locks);
    const matchup = evaluateMatchup(leg3, players.players, logs, locks.locks);
    const summary = formatLockAdvisorSummary(leg3, rows, matchup);

    expect(summary).toContain("Lock Advisor — Leg 3");
    expect(summary).toContain("Beltline Ballers");
    expect(summary).toContain(leg3.opponentName);
    expect(summary).toContain("Walker Kessler");
    expect(summary).toContain("Lauri Markkanen");
    expect(summary).toContain("LOCKED");
    expect(summary.toLowerCase()).not.toContain("mean");
  });

  it("formatMatchupSummary formats scoreboard, bounds, and bench swings without mean", () => {
    const matchup = evaluateMatchup(leg3, players.players, logs, locks.locks);
    const swings = evaluateBenchSwings(leg3, players.players, logs, locks.locks);
    const summary = formatMatchupSummary(leg3, matchup, swings);

    expect(summary).toContain("Weekly Matchup — Leg 3");
    expect(summary).toContain("User Bounds:");
    expect(summary).toContain("Starter Games Left:");
    expect(summary).toContain("Bench Swings:");
    expect(summary.toLowerCase()).not.toContain("mean");

    const emptySummary = formatMatchupSummary(leg3, matchup, []);
    expect(emptySummary).toContain("Bench Swings: None");
  });

  it("formatPlayerSummary includes Mean (ref only) and handles 0-GP players", () => {
    const kessler = players.players.find((p) => p.sleeperId === "2441")!;
    const analysis = analyzePlayer(kessler.sleeperId, logs);
    const text = formatPlayerSummary(kessler, analysis, "All season");

    expect(text).toContain("Walker Kessler");
    expect(text).toContain("All season");
    expect(text).toContain("Ceiling:");
    expect(text).toContain("Median:");
    expect(text).toContain("Floor:");
    expect(text).toContain("Mean (ref only):");

    const emptyAnalysis = analyzePlayer("2441", []);
    const emptyText = formatPlayerSummary(kessler, emptyAnalysis, "Last week");
    expect(emptyText).toContain("GP: 0");
    expect(emptyText).toContain("Mean (ref only): —");
  });

  it("buildRosterCsv produces RFC-4180 CSV with exact columns and no mean", () => {
    const specialPlayer: Player = {
      sleeperId: "9999",
      name: 'Doe, "Jr."',
      team: "LAL",
      positions: ["PG", "SG"],
      rosterStatus: "bench",
    };
    const rows = [
      { player: specialPlayer, analysis: analyzePlayer("9999", []) },
      {
        player: players.players.find((p) => p.sleeperId === "2441")!,
        analysis: analyzePlayer("2441", logs),
      },
    ];

    const csv = buildRosterCsv(rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Player,Team,Pos,Status,Ceiling,Median,Floor,Last Game,GP");
    expect(lines[0]?.toLowerCase()).not.toContain("mean");
    expect(lines[1]).toBe('"Doe, ""Jr.""",LAL,PG / SG,Bench,,,,,0');
    expect(lines[2]).toContain("Walker Kessler,LAL,C,Starter,62.50");
  });

  it("buildPlayerLogsCsv produces RFC-4180 CSV and ignores expectedTotal", () => {
    const kessler = players.players.find((p) => p.sleeperId === "2441")!;
    const fakeLogs: GameLog[] = [
      {
        sleeperId: "2441",
        date: "2026-11-01",
        opponent: "@POR",
        pts: 20,
        reb: 10,
        ast: 2,
        stl: 1,
        blk: 3,
        tov: 1,
        tf: 1,
        ff: 0,
        source: 'ESPN, "box" score',
        expectedTotal: 999.99, // Must NEVER be read
      },
    ];
    const scored = scoreLogs(fakeLogs);
    const csv = buildPlayerLogsCsv(kessler, scored);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe("Date,Opponent,Total,Pts,Reb,Ast,Stl,Blk,Tov,TF,FF,Source");
    expect(lines[1]).not.toContain("999.99");
    expect(lines[1]).toContain('"ESPN, ""box"" score"');
    expect(lines[1]).toMatch(/^2026-11-01,@POR,\d+\.\d{2},20,10,2,1,3,1,1,0,/);
  });

  it("copyToClipboard handles success, execCommand fallback, missing clipboard, and rejection", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyToClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");

    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    expect(await copyToClipboard("hello")).toBe(false);

    vi.stubGlobal("navigator", {});
    expect(await copyToClipboard("hello")).toBe(false);

    // Fallback succeeds when document.execCommand("copy") returns true
    const execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", {
      value: execCommandMock,
      configurable: true,
    });
    expect(await copyToClipboard("fallback-text")).toBe(true);
    expect(execCommandMock).toHaveBeenCalledWith("copy");
    delete (document as unknown as Record<string, unknown>).execCommand;
  });

  it("downloadCsv triggers Blob download with UTF-8 BOM and revokes object URL", async () => {
    let capturedBlob: Blob | null = null;
    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:mock-url";
    });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("test.csv", "a,b\r\n1,2");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(capturedBlob).not.toBeNull();
    const bytes = new Uint8Array(await (capturedBlob as unknown as Blob).arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("escapes embedded newlines (\\n and \\r\\n) in RFC-4180 CSV cells", () => {
    const kessler = players.players.find((p) => p.sleeperId === "2441")!;
    const newlinePlayer: Player = {
      ...kessler,
      name: "Line1\nLine2",
    };
    const rosterCsv = buildRosterCsv([
      { player: newlinePlayer, analysis: analyzePlayer("2441", []) },
    ]);
    expect(rosterCsv).toContain('"Line1\nLine2",LAL,C,Starter');

    const logWithCrlf: GameLog = {
      sleeperId: "2441",
      date: "2026-11-01",
      opponent: "POR",
      pts: 10,
      reb: 5,
      ast: 2,
      stl: 1,
      blk: 0,
      tov: 1,
      source: "note1\r\nnote2",
    };
    const logsCsv = buildPlayerLogsCsv(kessler, scoreLogs([logWithCrlf]));
    expect(logsCsv).toContain('"note1\r\nnote2"');
  });
});
