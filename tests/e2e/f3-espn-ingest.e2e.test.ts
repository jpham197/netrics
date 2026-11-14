// Opaque-box E2E tests for F3: ESPN Ingestion Resume, Multi-Day Backfill & Nightly/Sync Workflows.
// Never mutates repo `data/*.json` or calls live network APIs.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateAll } from "../../src/data/validate.js";
import { applyIngestionProposal, runEspnIngestion } from "../../src/espn/ingest.js";
import { parseIngestCliArgs } from "../../src/espn/ingest-cli.js";
import { fantasyPoints } from "../../src/scoring/index.js";
import {
  createTempDataWorkspace,
  makeEspnScoreboardPayload,
  makeEspnSummaryPayload,
  type TempDataWorkspace,
} from "./fixtures/e2eFixtures.js";

function buildEspnBackfillFetch() {
  return async (input: RequestInfo | URL): Promise<Response> => {
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
    if (url.includes("scoreboard") && url.includes("dates=20261107")) {
      return new Response(
        JSON.stringify(
          makeEspnScoreboardPayload("2026-11-07", [
            { eventId: "ev-1107", homeTeam: "PHX", awayTeam: "BOS", isFinal: true },
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
                { espnAthleteId: "3934672", displayName: "Jalen Brunson", min: "36:00", pts: 30, reb: 4, ast: 8, stl: 1, blk: 0, tov: 2 },
              ],
            },
          ]),
        ),
        { status: 200 },
      );
    }
    if (url.includes("summary") && url.includes("event=ev-1107")) {
      return new Response(
        JSON.stringify(
          makeEspnSummaryPayload([
            {
              teamAbbr: "PHX",
              athletes: [
                { espnAthleteId: "3136193", displayName: "Devin Booker", min: "35:00", pts: 28, reb: 5, ast: 6, stl: 1, blk: 0, tov: 3 },
              ],
            },
            {
              teamAbbr: "BOS",
              athletes: [
                { espnAthleteId: "4065648", displayName: "Jayson Tatum", min: "37:00", pts: 32, reb: 9, ast: 5, stl: 2, blk: 1, tov: 2 },
              ],
            },
          ]),
        ),
        { status: 200 },
      );
    }
    if (url.includes("api.sleeper.app")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    return new Response(JSON.stringify({ events: [] }), { status: 200 });
  };
}

describe("F3: ESPN Ingestion Resume & Backfill E2E", () => {
  let ws: TempDataWorkspace;

  beforeEach(() => {
    ws = createTempDataWorkspace();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ws.cleanup();
  });

  // Tier 1
  it("Tier 1: --from YYYY-MM-DD --to YYYY-MM-DD collects game logs across the inclusive date range", async () => {
    const parsed = parseIngestCliArgs(["--from", "2026-11-06", "--to", "2026-11-07"]);
    expect(parsed.dates).toEqual(["2026-11-06", "2026-11-07"]);

    const fetchMock = buildEspnBackfillFetch();
    const report = await runEspnIngestion({
      dates: parsed.dates,
      verifyExisting: false,
      playersFile: ws.readPlayers(),
      espnPlayerMap: ws.readEspnMap(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      locksFile: ws.readLocks(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(report.proposedLogs.map((p) => `${p.sleeperId}|${p.date}`)).toEqual(
      expect.arrayContaining(["s-pg-1|2026-11-06", "s-sg-1|2026-11-07", "s-sf-1|2026-11-07"]),
    );
  });

  it("Tier 1: --catch-up resumes from the day after PlayersFile.asOf through today in America/New_York", () => {
    const players = ws.readPlayers(); // asOf: 2026-11-05
    // 2026-11-07 15:00:00Z = 10:00 AM EST on 2026-11-07
    const fakeNow = new Date("2026-11-07T15:00:00Z");
    const parsed = parseIngestCliArgs(
      ["--catch-up"],
      process.cwd(),
      fakeNow,
      players.asOf,
    );
    expect(parsed.dates).toEqual(["2026-11-06", "2026-11-07"]);
  });

  it("Tier 1: --window-eastern remains supported", () => {
    const fakeNow = new Date("2026-11-07T15:00:00Z");
    const parsed = parseIngestCliArgs(["--window-eastern"], process.cwd(), fakeNow);
    expect(parsed.windowEastern).toBe(true);
    expect(parsed.dates).toEqual(["2026-11-06", "2026-11-07"]);
  });

  it("Tier 1: .github/workflows/ingest-nightly.yml has scheduled cron '0 5 * * *'", () => {
    const workflowPath = resolve(process.cwd(), ".github/workflows/ingest-nightly.yml");
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toMatch(/^\s*schedule:/m);
    expect(content).toMatch(/^\s*-\s*cron:\s*["']0 5 \* \* \*["']/m);
  });

  it("Tier 1: .github/workflows/sync-sleeper.yml exists and runs sync:sleeper --apply-to-data + validate + PR creation", () => {
    const workflowPath = resolve(process.cwd(), ".github/workflows/sync-sleeper.yml");
    expect(existsSync(workflowPath)).toBe(true);
    const content = readFileSync(workflowPath, "utf-8");
    expect(content).toContain("sync:sleeper");
    expect(content).toContain("--apply-to-data");
    expect(content).toContain("npm run validate");
    expect(content).toContain("gh pr create");
  });

  // Tier 2
  it("Tier 2: rejects invalid --from > --to date range", () => {
    expect(() =>
      parseIngestCliArgs(["--from", "2026-11-08", "--to", "2026-11-06"]),
    ).toThrow();
  });

  it("Tier 2: rejects --from without --to", () => {
    expect(() => parseIngestCliArgs(["--from", "2026-11-06"])).toThrow();
  });

  it("Tier 2: rejects --to without --from", () => {
    expect(() => parseIngestCliArgs(["--to", "2026-11-06"])).toThrow();
  });

  it("Tier 2: --from === --to produces a single-day inclusive date range", () => {
    const parsed = parseIngestCliArgs(["--from", "2026-11-06", "--to", "2026-11-06"]);
    expect(parsed.dates).toEqual(["2026-11-06"]);
  });

  it("Tier 2: deduplicates (sleeperId, date) across multi-day backfill when date already exists in game-logs.json", async () => {
    // 2026-11-05 is already logged for Devin Booker (s-sg-1) and Jayson Tatum (s-sf-1)
    const fetchMock = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("scoreboard") && url.includes("dates=20261105")) {
        return new Response(
          JSON.stringify(
            makeEspnScoreboardPayload("2026-11-05", [
              { eventId: "ev-1105", homeTeam: "PHX", awayTeam: "NOP", isFinal: true },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-1105")) {
        return new Response(
          JSON.stringify(
            makeEspnSummaryPayload([
              {
                teamAbbr: "PHX",
                athletes: [
                  { espnAthleteId: "3136193", displayName: "Devin Booker", min: "34:00", pts: 22, reb: 3, ast: 5, stl: 0, blk: 0, tov: 2 },
                ],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      return buildEspnBackfillFetch()(input);
    };

    const parsed = parseIngestCliArgs(["--from", "2026-11-05", "--to", "2026-11-06"]);
    const report = await runEspnIngestion({
      dates: parsed.dates,
      verifyExisting: false,
      playersFile: ws.readPlayers(),
      espnPlayerMap: ws.readEspnMap(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      locksFile: ws.readLocks(),
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const booker1105 = report.proposedLogs.filter(
      (p) => p.sleeperId === "s-sg-1" && p.date === "2026-11-05",
    );
    expect(booker1105).toHaveLength(0);
    expect(report.proposedLogs.some((p) => p.sleeperId === "s-pg-1" && p.date === "2026-11-06")).toBe(true);
  });

  it("Tier 2: --catch-up when already up-to-date (asOf >= today) yields empty catch-up date list", () => {
    const fakeNow = new Date("2026-11-05T15:00:00Z"); // 2026-11-05 in ET, same as asOf
    const parsed = parseIngestCliArgs(
      ["--catch-up"],
      process.cwd(),
      fakeNow,
      "2026-11-05",
    );
    expect(parsed.dates).toEqual([]);
  });

  it("Tier 2: validateAll passes after multi-day backfill applyIngestionProposal", async () => {
    const parsed = parseIngestCliArgs(["--from", "2026-11-06", "--to", "2026-11-07"]);
    const report = await runEspnIngestion({
      dates: parsed.dates,
      verifyExisting: false,
      playersFile: ws.readPlayers(),
      espnPlayerMap: ws.readEspnMap(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      locksFile: ws.readLocks(),
      fetchImpl: buildEspnBackfillFetch() as unknown as typeof fetch,
    });

    const existingLogs = ws.readLogs();
    const { updatedLogs, updatedWeeks, updatedPlayers } = applyIngestionProposal({
      report,
      playersFile: ws.readPlayers(),
      existingLogs,
      weeksFile: ws.readWeeks(),
      espnPlayerMap: ws.readEspnMap(),
    });

    expect(updatedLogs.length).toBe(existingLogs.length + 3);
    const addedKeys = ["s-pg-1|2026-11-06", "s-sg-1|2026-11-07", "s-sf-1|2026-11-07"];
    for (const key of addedKeys) {
      const [sid, date] = key.split("|");
      const found = updatedLogs.find((l) => l.sleeperId === sid && l.date === date);
      expect(found).toBeDefined();
      expect(found?.expectedTotal).toBe(fantasyPoints(found!).total);
    }

    const leg3 = updatedWeeks.weeks.find((w) => w.leg === 3)!;
    expect(leg3.remainingGames["s-pg-1"]).not.toContain("2026-11-06");
    expect(leg3.remainingGames["s-sg-1"]).not.toContain("2026-11-07");
    expect(leg3.remainingGames["s-sf-1"]).not.toContain("2026-11-07");

    const errors = validateAll(updatedPlayers, updatedLogs, updatedWeeks, ws.readLocks(), ws.readEspnMap());
    expect(errors).toEqual([]);
  });
});
