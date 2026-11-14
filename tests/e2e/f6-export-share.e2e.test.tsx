// @vitest-environment jsdom
// Opaque-box E2E tests for F6: Export & Share Views (URL Hash Routing, Copy Summary, Export CSV, Print Styles).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluateBenchSwings, evaluateMatchup } from "../../src/advisor/index.js";
import { App } from "../../src/ui/App.js";
import {
  createFixtureGameLogs,
  createFixtureLocksFile,
  createFixturePlayersFile,
  createFixtureWeeksFile,
  createUiFetchStub,
} from "./fixtures/e2eFixtures.js";

describe("F6: Export & Share Views E2E", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;
  let createObjectUrlMock: ReturnType<typeof vi.fn>;
  let revokeObjectUrlMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal("fetch", createUiFetchStub());
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    createObjectUrlMock = vi.fn().mockReturnValue("blob:netrics-e2e-csv");
    revokeObjectUrlMock = vi.fn();
    URL.createObjectURL = createObjectUrlMock as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectUrlMock as unknown as typeof URL.revokeObjectURL;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // Tier 1
  it("Tier 1: URL hash routing navigates App on load (#advisor, #matchup, #player/<id>) and updates hash on click", async () => {
    window.location.hash = "#advisor";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Matchup" }));
    expect(window.location.hash).toBe("#matchup");
    expect(screen.getByText(/Bench Swing/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    expect(window.location.hash).toBe("#roster");
    expect(screen.getByText("Beltline Ballers")).toBeTruthy();

    fireEvent.click(screen.getByText("Nikola Jokic"));
    expect(window.location.hash).toBe("#player/s-c-1");
  });

  it("Tier 1: Copy Summary in LockAdvisorView copies summary text to clipboard", async () => {
    window.location.hash = "#advisor";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy();
    });

    const copyBtn = screen.getByRole("button", { name: /copy summary/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    const copied = writeTextMock.mock.calls[0]?.[0] as string;
    expect(copied).toContain("Leg 3");
    expect(copied).toContain("Nikola Jokic");
  });

  it("Tier 1: Copy Summary in MatchupView and PlayerDetail copies summary text to clipboard", async () => {
    window.location.hash = "#matchup";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Bench Swing/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /copy summary/i }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(1);
    });
    expect(String(writeTextMock.mock.calls[0]?.[0])).toContain("HoopsRival");

    fireEvent.click(screen.getByRole("button", { name: "Roster" }));
    fireEvent.click(screen.getByText("Nikola Jokic"));
    await waitFor(() => {
      expect(screen.getByText(/Mean \(ref only\)/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /copy summary/i }));
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledTimes(2);
    });
    expect(String(writeTextMock.mock.calls[1]?.[0])).toContain("Nikola Jokic");
  });

  it("Tier 1: hashchange event updates active view on browser Back/Forward navigation (#roster -> #advisor -> #roster)", async () => {
    window.location.hash = "#roster";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });

    window.location.hash = "#advisor";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => {
      expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy();
    });

    window.location.hash = "#roster";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => {
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });
  });

  it("Tier 1: Export CSV in RosterView and PlayerDetail produces valid CSV without mean or expectedTotal", async () => {
    const logsWithExpected = createFixtureGameLogs().map((l) => ({ ...l, expectedTotal: 999.99 }));
    vi.stubGlobal("fetch", createUiFetchStub({ logs: logsWithExpected }));

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });

    const anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    const rosterBlob = createObjectUrlMock.mock.calls[0]?.[0] as Blob;
    expect(rosterBlob).toBeInstanceOf(Blob);
    const rosterCsvText = await rosterBlob.text();
    const rosterHeader = rosterCsvText.split("\n")[0] ?? "";
    expect(rosterHeader).toContain("Player");
    expect(rosterHeader).toContain("Team");
    expect(rosterHeader).toContain("Pos");
    expect(rosterHeader).toContain("Status");
    expect(rosterHeader).toContain("Ceiling");
    expect(rosterHeader).toContain("Median");
    expect(rosterHeader).toContain("Floor");
    expect(rosterCsvText).toContain("Nikola Jokic");
    expect(rosterCsvText).toContain("Jalen Brunson");
    expect(rosterCsvText.toLowerCase()).not.toContain("mean");
    expect(rosterCsvText).not.toContain("expectedTotal");
    expect(rosterCsvText).not.toContain("999.99");

    fireEvent.click(screen.getByText("Nikola Jokic"));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /export csv/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    expect(createObjectUrlMock).toHaveBeenCalledTimes(2);
    const playerBlob = createObjectUrlMock.mock.calls[1]?.[0] as Blob;
    expect(playerBlob).toBeInstanceOf(Blob);
    const playerCsvText = await playerBlob.text();
    const playerHeader = playerCsvText.split("\n")[0] ?? "";
    expect(playerHeader).toContain("Date");
    expect(playerHeader).toContain("Opponent");
    expect(playerHeader).toContain("Total");
    expect(playerHeader).toContain("Source");
    expect(playerCsvText).toContain("2026-11-02");
    expect(playerCsvText.toLowerCase()).not.toContain("mean");
    expect(playerCsvText).not.toContain("expectedTotal");
    expect(playerCsvText).not.toContain("999.99");

    anchorClickSpy.mockRestore();
  });

  it("Tier 1: @media print in styles.css hides navigation and action buttons", () => {
    const css = readFileSync(resolve(process.cwd(), "src/ui/styles.css"), "utf-8");
    const printIdx = css.indexOf("@media print");
    expect(printIdx).toBeGreaterThan(-1);
    const printBlock = css.slice(printIdx);
    expect(printBlock).toContain("display: none");
    expect(printBlock).toMatch(/app-nav|button/);
  });

  // Tier 2
  it("Tier 2: invalid/unknown hash #nonexistent falls back safely to default Roster view without crash", async () => {
    window.location.hash = "#nonexistent";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });
  });

  it("Tier 2: #player/unknown-id handles missing player gracefully", async () => {
    window.location.hash = "#player/unknown-id";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Player not found/i)).toBeTruthy();
    });
  });

  it("Tier 2: CSV fields containing commas or double quotes are properly RFC-4180 escaped", async () => {
    const exportSharePath = "../../src/ui/exportShare.js";
    const exportMod = await import(/* @vite-ignore */ exportSharePath);
    const players = createFixturePlayersFile();
    players.players[0]!.name = 'Brunson, "Jalen"';
    const csv = exportMod.buildRosterCsv(
      players.players.map((player) => ({
        player,
        summary: {
          gamesPlayed: 1,
          ceiling: 40,
          floor: 40,
          median: 40,
          lastGame: null,
          mean: 40,
        },
      })),
    );
    expect(csv).toContain('"Brunson, ""Jalen"""');
  });

  it("Tier 2: AGENTS.md invariant — LockAdvisor/Matchup/Roster summaries and CSVs never leak expectedTotal or mean", async () => {
    const exportSharePath = "../../src/ui/exportShare.js";
    const exportMod = await import(/* @vite-ignore */ exportSharePath);
    const players = createFixturePlayersFile();
    const logs = createFixtureGameLogs().map((l) => ({ ...l, expectedTotal: 999.99 }));

    const rosterCsv = exportMod.buildRosterCsv(
      players.players.map((player) => ({
        player,
        summary: { gamesPlayed: 2, ceiling: 50, floor: 30, median: 40, lastGame: null, mean: 40 },
      })),
    );
    expect(rosterCsv.toLowerCase()).not.toContain("mean");
    expect(rosterCsv).not.toContain("expectedTotal");
    expect(rosterCsv).not.toContain("999.99");

    const advisorSummary = exportMod.formatLockAdvisorSummary(
      {
        leg: 3,
        startDate: "2026-11-02",
        endDate: "2026-11-08",
        matchupId: 1,
        opponentRosterId: 2,
        opponentName: "HoopsRival",
        opponentPoints: 342.5,
        opponentAsOf: "2026-11-05T23:00:00Z",
        starters: [],
        bench: [],
        reserve: [],
        remainingGames: {},
      },
      [],
      {
        userTotal: 300,
        opponentTotal: 342.5,
        margin: -42.5,
        userFloor: 300,
        userCeiling: 400,
        remainingStarterGames: 5,
        starters: [],
      },
    );
    expect(advisorSummary.toLowerCase()).not.toContain("mean");
    expect(advisorSummary).not.toContain("expectedTotal");

    const week = createFixtureWeeksFile().weeks[0]!;
    const locks = createFixtureLocksFile(logs).locks;
    const matchup = evaluateMatchup(week, players.players, logs, locks);
    const swings = evaluateBenchSwings(week, players.players, logs, locks);
    const matchupSummary = exportMod.formatMatchupSummary(week, matchup, swings);
    expect(matchupSummary.toLowerCase()).not.toContain("mean");
    expect(matchupSummary).not.toContain("expectedTotal");
    expect(matchupSummary).not.toContain("999.99");
  });

  it("Tier 2: PlayerDetail CSV contains no expectedTotal even when GameLog.expectedTotal is present", async () => {
    const exportSharePath = "../../src/ui/exportShare.js";
    const exportMod = await import(/* @vite-ignore */ exportSharePath);
    const player = createFixturePlayersFile().players[0]!;
    const logs = createFixtureGameLogs()
      .filter((l) => l.sleeperId === player.sleeperId)
      .map((l) => ({ ...l, expectedTotal: 888.88 }));

    const csv = exportMod.buildPlayerLogsCsv(player, logs);
    expect(csv).not.toContain("expectedTotal");
    expect(csv).not.toContain("888.88");
    expect(csv.split("\n")[0]).toContain("Date");
    expect(csv.split("\n")[0]).toContain("Source");
  });
});
