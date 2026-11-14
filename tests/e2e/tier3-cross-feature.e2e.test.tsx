// @vitest-environment jsdom
// Opaque-box E2E tests for Tier 3: Pairwise Cross-Feature Combinations (F2+F3, F2+F4, F3+F6, F4+F5, F4+F6, F5+F6).

import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LEAGUE_ID } from "../../src/data/types.js";
import { validateAll } from "../../src/data/validate.js";
import { applyIngestionProposal, runEspnIngestion } from "../../src/espn/ingest.js";
import { App } from "../../src/ui/App.js";
import {
  createTempDataWorkspace,
  createUiFetchStub,
  makeEspnScoreboardPayload,
  makeEspnSummaryPayload,
  type TempDataWorkspace,
} from "./fixtures/e2eFixtures.js";
import { selectFilterOption } from "./fixtures/uiTestHelpers.js";

describe("Tier 3: Pairwise Cross-Feature E2E", () => {
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
    createObjectUrlMock = vi.fn().mockReturnValue("blob:tier3-csv");
    URL.createObjectURL = createObjectUrlMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    ws.cleanup();
  });

  it("F2+F3: Sleeper syncApply followed by ESPN backfill ingestion passes validateAll with 0 errors", async () => {
    const syncApplyPath = "../../src/sleeper/syncApply.js";
    const syncApplyMod = await import(/* @vite-ignore */ syncApplyPath);
    const mockFetch = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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
                athletes: [{ espnAthleteId: "3934672", displayName: "Jalen Brunson", min: "35:00", pts: 31, reb: 4, ast: 7, stl: 1, blk: 0, tov: 2 }],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ events: [] }), { status: 200 });
    };

    vi.stubGlobal("fetch", mockFetch);
    await syncApplyMod.runSleeperSyncApply({
      playersPath: ws.playersPath,
      weeksPath: ws.weeksPath,
      logsPath: ws.logsPath,
      espnMapPath: ws.espnMapPath,
      applyToData: true,
    });

    const report = await runEspnIngestion({
      dates: ["2026-11-06"],
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

    expect(
      validateAll(ws.readPlayers(), ws.readLogs(), ws.readWeeks(), ws.readLocks(), ws.readEspnMap()),
    ).toEqual([]);
  });

  it("F2+F4: synced reserve player (retained after drop) is located via RosterView status filter", async () => {
    const players = ws.readPlayers();
    // Simulate s-b2-1 marked as reserve by syncApply
    players.players = players.players.map((p) =>
      p.sleeperId === "s-b2-1" ? { ...p, rosterStatus: "reserve" } : p,
    );
    vi.stubGlobal("fetch", createUiFetchStub({ players }));

    render(<App />);
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());

    selectFilterOption(/status/i, "reserve", /reserve/i);
    expect(screen.getByText("Bam Adebayo")).toBeTruthy();
    expect(screen.getByText("Paolo Banchero")).toBeTruthy();
    expect(screen.queryByText("Nikola Jokic")).toBeNull();
  });

  it("F3+F6: newly ingested game log is reflected in PlayerDetail summary and CSV export", async () => {
    const report = await runEspnIngestion({
      dates: ["2026-11-06"],
      verifyExisting: false,
      playersFile: ws.readPlayers(),
      espnPlayerMap: ws.readEspnMap(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      locksFile: ws.readLocks(),
      fetchImpl: (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("scoreboard")) {
          return new Response(
            JSON.stringify(makeEspnScoreboardPayload("2026-11-06", [{ eventId: "ev-6", homeTeam: "NYK", awayTeam: "MIL", isFinal: true }])),
            { status: 200 },
          );
        }
        if (url.includes("summary")) {
          return new Response(
            JSON.stringify(
              makeEspnSummaryPayload([
                {
                  teamAbbr: "NYK",
                  athletes: [{ espnAthleteId: "3934672", displayName: "Jalen Brunson", min: "38:00", pts: 45, reb: 5, ast: 10, stl: 2, blk: 0, tov: 1 }],
                },
              ]),
            ),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify([]), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const applied = applyIngestionProposal({
      report,
      playersFile: ws.readPlayers(),
      existingLogs: ws.readLogs(),
      weeksFile: ws.readWeeks(),
      espnPlayerMap: ws.readEspnMap(),
    });

    vi.stubGlobal(
      "fetch",
      createUiFetchStub({
        players: applied.updatedPlayers,
        logs: applied.updatedLogs,
        weeks: applied.updatedWeeks,
      }),
    );

    window.location.hash = "#player/s-pg-1";
    render(<App />);
    await waitFor(() => expect(screen.getByText("Jalen Brunson")).toBeTruthy());

    expect(screen.getByTestId("breakdown-2026-11-06")).toBeTruthy();

    const anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    anchorClickSpy.mockRestore();
  });

  it("F4+F5: filtered RosterView and LockAdvisorView render cleanly on mobile viewport", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    vi.stubGlobal("fetch", createUiFetchStub());

    render(<App />);
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());

    selectFilterOption(/position/i, "C", /^C$/i);
    expect(screen.getByText("Nikola Jokic")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Lock Advisor" }));
    await waitFor(() => expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/i }));
    expect(screen.getByText("Devin Booker")).toBeTruthy();
  });

  it("F4+F6: filtered LockAdvisorView + Copy Summary + hash navigation to PlayerDetail", async () => {
    vi.stubGlobal("fetch", createUiFetchStub());
    window.location.hash = "#advisor";
    render(<App />);
    await waitFor(() => expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/i }));
    fireEvent.click(screen.getByRole("button", { name: /copy summary/i }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Devin Booker"));
    expect(window.location.hash).toBe("#player/s-sg-1");
  });

  it("F5+F6: #player/<id> deep link renders BoxPlot SVG and styles.css includes @media print", async () => {
    vi.stubGlobal("fetch", createUiFetchStub());
    window.location.hash = "#player/s-c-1";
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("boxplot-svg")).toBeTruthy());

    const css = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf-8");
    expect(css).toMatch(/@media\s+print/);
    expect(css).toMatch(/@media\s*\(\s*max-width:/);
  });
});
