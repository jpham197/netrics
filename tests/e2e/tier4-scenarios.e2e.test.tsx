// @vitest-environment jsdom
// Opaque-box E2E tests for Tier 4: Realistic End-to-End Scenarios.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAGUE_ID } from "../../src/data/types.js";
import { validateAll } from "../../src/data/validate.js";
import { applyIngestionProposal, runEspnIngestion } from "../../src/espn/ingest.js";
import { parseIngestCliArgs } from "../../src/espn/ingest-cli.js";
import { App } from "../../src/ui/App.js";
import {
  createTempDataWorkspace,
  createUiFetchStub,
  makeEspnScoreboardPayload,
  makeEspnSummaryPayload,
  type TempDataWorkspace,
} from "./fixtures/e2eFixtures.js";
import { selectFilterOption } from "./fixtures/uiTestHelpers.js";

describe("Tier 4: Realistic End-to-End Scenarios", () => {
  let ws: TempDataWorkspace;
  let writeTextMock: ReturnType<typeof vi.fn>;
  let createObjectUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.location.hash = "";
    ws = createTempDataWorkspace();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    createObjectUrlMock = vi.fn().mockReturnValue("blob:tier4-csv");
    URL.createObjectURL = createObjectUrlMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ws.cleanup();
  });

  it("Scenario 1: Nightly automation pipeline — ESPN catch-up ingest + Sleeper sync passes validateAll and leaves locks.json untouched", async () => {
    const syncApplyPath = "../../src/sleeper/syncApply.js";
    const syncApplyMod = await import(/* @vite-ignore */ syncApplyPath);
    const locksBefore = readFileSync(ws.locksPath, "utf-8");

    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("scoreboard") && url.includes("dates=20261106")) {
        return new Response(
          JSON.stringify(makeEspnScoreboardPayload("2026-11-06", [{ eventId: "ev-6", homeTeam: "NYK", awayTeam: "MIL", isFinal: true }])),
          { status: 200 },
        );
      }
      if (url.includes("summary") && url.includes("event=ev-6")) {
        return new Response(
          JSON.stringify(
            makeEspnSummaryPayload([
              {
                teamAbbr: "NYK",
                athletes: [{ espnAthleteId: "3934672", displayName: "Jalen Brunson", min: "35:00", pts: 34, reb: 4, ast: 8, stl: 1, blk: 0, tov: 2 }],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.endsWith("/state/nba")) {
        return new Response(JSON.stringify({ leg: 3, week: 3, season: "2026" }), { status: 200 });
      }
      if (url.endsWith(`/league/${LEAGUE_ID}/rosters`)) {
        return new Response(
          JSON.stringify([
            {
              roster_id: 1,
              players: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1", "s-b1-1", "s-b2-1", "s-r1-1"],
              starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
              reserve: ["s-r1-1"],
            },
            { roster_id: 2, players: ["opp-1"], starters: ["opp-1"], reserve: [] },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/league/${LEAGUE_ID}/matchups/`)) {
        return new Response(
          JSON.stringify([
            {
              roster_id: 1,
              matchup_id: 1,
              points: 310.0,
              starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
              players_points: {},
            },
            { roster_id: 2, matchup_id: 1, points: 360.0, starters: ["opp-1"], players_points: {} },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/league/${LEAGUE_ID}/transactions/`) || url.endsWith(`/league/${LEAGUE_ID}/users`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/players/nba")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    };

    vi.stubGlobal("fetch", mockFetch);

    // 1. Catch-up ESPN ingestion
    const parsed = parseIngestCliArgs(["--catch-up"], process.cwd(), new Date("2026-11-06T16:00:00Z"), ws.readPlayers().asOf);
    const report = await runEspnIngestion({
      dates: parsed.dates,
      verifyExisting: false,
      playersFile: ws.readPlayers(),
      espnPlayerMap: ws.readEspnMap(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      locksFile: ws.readLocks(),
      fetchImpl: mockFetch as unknown as typeof fetch,
    });
    const applied = applyIngestionProposal({
      report,
      playersFile: ws.readPlayers(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      espnPlayerMap: ws.readEspnMap(),
    });
    writeFileSync(ws.logsPath, `${JSON.stringify(applied.updatedLogs, null, 2)}\n`, "utf-8");
    writeFileSync(ws.weeksPath, `${JSON.stringify(applied.updatedWeeks, null, 2)}\n`, "utf-8");
    writeFileSync(ws.playersPath, `${JSON.stringify(applied.updatedPlayers, null, 2)}\n`, "utf-8");

    // 2. Sleeper roster/week sync
    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    expect(readFileSync(ws.locksPath, "utf-8")).toBe(locksBefore);
    expect(
      validateAll(ws.readPlayers(), ws.readLogs(), ws.readWeeks(), ws.readLocks(), ws.readEspnMap()),
    ).toEqual([]);
  });

  it("Scenario 2: Sunday lock decision workflow — #advisor Needs Decision -> PlayerDetail Spikes only -> Copy Summary -> #matchup hide locked swaps", async () => {
    vi.stubGlobal("fetch", createUiFetchStub());
    window.location.hash = "#advisor";
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/i }));
    expect(screen.getByText("Devin Booker")).toBeTruthy();
    expect(screen.queryByText("Nikola Jokic")).toBeNull();

    fireEvent.click(screen.getByText("Devin Booker"));
    await waitFor(() => expect(window.location.hash).toBe("#player/s-sg-1"));

    fireEvent.click(screen.getByLabelText(/spikes only/i));
    fireEvent.click(screen.getByRole("button", { name: /copy summary/i }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Matchup" }));
    await waitFor(() => expect(window.location.hash).toBe("#matchup"));
    const hideLockedToggle = screen.getByLabelText(/hide locked/i) as HTMLInputElement;
    fireEvent.click(hideLockedToggle);
    expect(hideLockedToggle.checked).toBe(true);
  });

  it("Scenario 3: Roster management & CSV export — #roster filter by position + search -> Export CSV -> no mean or expectedTotal leaked", async () => {
    const exportSharePath = "../../src/ui/exportShare.js";
    const exportMod = await import(/* @vite-ignore */ exportSharePath);
    vi.stubGlobal("fetch", createUiFetchStub());
    window.location.hash = "#roster";
    render(<App />);
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());

    selectFilterOption(/position/i, "PG", /^PG$/i);
    const searchInput = screen.queryByRole("searchbox") ?? screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "Brunson" } });
    expect(screen.getByText("Jalen Brunson")).toBeTruthy();

    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    anchorClickSpy.mockRestore();

    const csv = exportMod.buildRosterCsv([
      {
        player: ws.readPlayers().players[0]!,
        summary: { gamesPlayed: 4, ceiling: 60, floor: 35, median: 50, lastGame: null, mean: 48 },
      },
    ]);
    expect(csv.toLowerCase()).not.toContain("mean");
    expect(csv).not.toContain("expectedTotal");
  });

  it("Scenario 4: Mid-week trade/drop — Sleeper drops a player with historical logs -> sync marks reserve -> validateAll passes -> RosterView locates them", async () => {
    const syncApplyPath = "../../src/sleeper/syncApply.js";
    const syncApplyMod = await import(/* @vite-ignore */ syncApplyPath);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/state/nba")) return new Response(JSON.stringify({ leg: 3, week: 3, season: "2026" }), { status: 200 });
      if (url.endsWith(`/league/${LEAGUE_ID}/rosters`)) {
        return new Response(
          JSON.stringify([
            {
              roster_id: 1,
              // s-b2-1 (Bam Adebayo) dropped from Sleeper roster
              players: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1", "s-b1-1", "s-r1-1"],
              starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
              reserve: ["s-r1-1"],
            },
            { roster_id: 2, players: ["opp-1"], starters: ["opp-1"], reserve: [] },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/league/${LEAGUE_ID}/matchups/`)) {
        return new Response(
          JSON.stringify([
            {
              roster_id: 1,
              matchup_id: 1,
              points: 310.0,
              starters: ["s-pg-1", "s-sg-1", "s-g-1", "s-sf-1", "s-pf-1", "s-f-1", "s-c-1", "s-u1-1", "s-u2-1"],
              players_points: {},
            },
            { roster_id: 2, matchup_id: 1, points: 342.5, starters: ["opp-1"], players_points: {} },
          ]),
          { status: 200 },
        );
      }
      if (url.includes(`/league/${LEAGUE_ID}/transactions/`) || url.endsWith(`/league/${LEAGUE_ID}/users`)) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.endsWith("/players/nba")) {
        return new Response(JSON.stringify({}), { status: 200 });
      }
      if (url.includes("scoreboard")) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const syncedPlayers = ws.readPlayers();
    expect(
      validateAll(syncedPlayers, ws.readLogs(), ws.readWeeks(), ws.readLocks(), ws.readEspnMap()),
    ).toEqual([]);

    vi.stubGlobal(
      "fetch",
      createUiFetchStub({
        players: syncedPlayers,
        logs: ws.readLogs(),
        weeks: ws.readWeeks(),
        locks: ws.readLocks(),
      }),
    );

    render(<App />);
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());
    selectFilterOption(/status/i, "reserve", /reserve/i);
    expect(screen.getByText("Bam Adebayo")).toBeTruthy();
  });

  it("Scenario 5: Mobile quick-check — deep-link #matchup on narrow viewport verifies responsive CSS, touch targets, and Copy Summary", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    vi.stubGlobal("fetch", createUiFetchStub());
    window.location.hash = "#matchup";

    render(<App />);
    await waitFor(() => expect(screen.getByText(/Bench Swing/i)).toBeTruthy());

    const css = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf-8");
    expect(css).toMatch(/@media\s*\(\s*max-width:\s*(640|768)px\s*\)/);
    expect(css).toMatch(/min-height:\s*(40|42|44|48)px/);

    fireEvent.click(screen.getByRole("button", { name: /copy summary/i }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));
    expect(String(writeTextMock.mock.calls[0]?.[0])).toContain("HoopsRival");
  });
});
