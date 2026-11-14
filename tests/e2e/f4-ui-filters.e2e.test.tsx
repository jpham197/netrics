// @vitest-environment jsdom
// Opaque-box E2E tests for F4: Multi-View UI Filters across Roster, Lock Advisor, Matchup, and Player Detail.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/ui/App.js";
import { fantasyPoints } from "../../src/scoring/index.js";
import {
  createFixtureGameLogs,
  createFixturePlayersFile,
  createFixtureWeeksFile,
  createUiFetchStub,
} from "./fixtures/e2eFixtures.js";
import { selectFilterOption } from "./fixtures/uiTestHelpers.js";

describe("F4: Multi-View UI Filters E2E", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal("fetch", createUiFetchStub());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function renderLoadedApp() {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });
  }

  // Tier 1
  it("Tier 1: RosterView search filters players by name or team", async () => {
    await renderLoadedApp();
    const searchInput = screen.queryByRole("searchbox") ?? screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "Jokic" } });

    expect(screen.getByText("Nikola Jokic")).toBeTruthy();
    expect(screen.queryByText("Jalen Brunson")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "NYK" } });
    expect(screen.getByText("Jalen Brunson")).toBeTruthy();
    expect(screen.queryByText("Nikola Jokic")).toBeNull();
  });

  it("Tier 1: RosterView position filter filters players by PG/SG/SF/PF/C", async () => {
    await renderLoadedApp();
    selectFilterOption(/position/i, "C", /^C$/i);

    expect(screen.getByText("Nikola Jokic")).toBeTruthy();
    expect(screen.getByText("Bam Adebayo")).toBeTruthy();
    expect(screen.queryByText("Jalen Brunson")).toBeNull();
  });

  it("Tier 1: RosterView status filter filters by starter / bench / reserve", async () => {
    await renderLoadedApp();
    selectFilterOption(/status/i, "reserve", /reserve/i);

    expect(screen.getByText("Paolo Banchero")).toBeTruthy();
    expect(screen.queryByText("Nikola Jokic")).toBeNull();
    expect(screen.queryByText("Darius Garland")).toBeNull();
  });

  it("Tier 1: LockAdvisorView filter switches between All, Needs Decision, and Locked", async () => {
    await renderLoadedApp();
    fireEvent.click(screen.getByRole("button", { name: "Lock Advisor" }));
    await waitFor(() => {
      expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy();
    });

    // Initially All: both locked (Jokic, Brunson) and unlocked (Booker) are visible
    expect(screen.getByText("Nikola Jokic")).toBeTruthy();
    expect(screen.getByText("Devin Booker")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/i }));
    expect(screen.getByText("Devin Booker")).toBeTruthy();
    expect(screen.queryByText("Nikola Jokic")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /^Locked$/i }));
    expect(screen.getByText("Nikola Jokic")).toBeTruthy();
    expect(screen.queryByText("Devin Booker")).toBeNull();
  });

  it("Tier 1: MatchupView toggle hides locked-starter swaps in Bench Swing table while keeping unlocked swaps visible", async () => {
    const logs = createFixtureGameLogs();
    const players = createFixturePlayersFile();
    // Lock Jalen Brunson (s-pg-1) at a low 25.00 score so bench Darius Garland (53 FP) has a positive swap
    // against a locked starter, while Devin Booker (s-sg-1, unlocked, 33 FP) remains an unlocked swap target.
    const lowBrunsonLock = {
      sleeperId: "s-pg-1",
      leg: 3,
      gameDate: "2026-10-28",
      lockedTotal: 25.0,
      lockedAt: "2026-10-29T05:00:00Z",
      source: "user" as const,
    };
    const jokicLog = logs.find((l) => l.sleeperId === "s-c-1" && l.date === "2026-11-02")!;
    vi.stubGlobal(
      "fetch",
      createUiFetchStub({
        players,
        logs,
        locks: {
          leagueId: players.leagueId,
          locks: [
            {
              sleeperId: "s-c-1",
              leg: 3,
              gameDate: "2026-11-02",
              lockedTotal: fantasyPoints(jokicLog).total,
              lockedAt: "2026-11-03T05:00:00Z",
              source: "user",
            },
            lowBrunsonLock,
          ],
        },
      }),
    );

    await renderLoadedApp();
    fireEvent.click(screen.getByRole("button", { name: "Matchup" }));
    await waitFor(() => {
      expect(screen.getByText(/Bench Swing/i)).toBeTruthy();
    });

    const swingSection = screen.queryByRole("region", { name: /bench swing/i }) ?? document.body;
    // Before toggling: both locked starter (Jalen Brunson) and unlocked starter (Devin Booker) appear in Bench Swing
    expect(swingSection.textContent).toContain("Jalen Brunson");
    expect(swingSection.textContent).toContain("Devin Booker");

    const toggle = screen.getByLabelText(/hide locked/i) as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    expect(toggle.checked).toBe(true);
    // Locked-starter swap (Jalen Brunson) is hidden, while unlocked-starter swap (Devin Booker) remains visible
    expect(swingSection.textContent).not.toContain("Jalen Brunson");
    expect(swingSection.textContent).toContain("Devin Booker");
  });

  it("Tier 1: PlayerDetail Spikes only toggle filters game-by-game distribution to spike games", async () => {
    await renderLoadedApp();
    fireEvent.click(screen.getByText("Jalen Brunson"));
    await waitFor(() => {
      expect(screen.getByText("Jalen Brunson")).toBeTruthy();
    });

    // Brunson has 4 games; Top 3 are spikes, 4th (2026-10-28, 24 pts) is non-spike
    expect(screen.getByTestId("breakdown-2026-10-28")).toBeTruthy();

    const spikesToggle = screen.getByLabelText(/spikes only/i);
    fireEvent.click(spikesToggle);

    expect(screen.queryByTestId("breakdown-2026-10-28")).toBeNull();
    expect(screen.getByTestId("breakdown-2026-10-25")).toBeTruthy();
  });

  // Tier 2
  it("Tier 2: RosterView search is case-insensitive and trims whitespace", async () => {
    await renderLoadedApp();
    const searchInput = screen.queryByRole("searchbox") ?? screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "   jOkIc   " } });

    expect(screen.getByText("Nikola Jokic")).toBeTruthy();
    expect(screen.queryByText("Devin Booker")).toBeNull();
  });

  it("Tier 2: combined RosterView filters (search + position + status) narrow results together", async () => {
    await renderLoadedApp();
    const searchInput = screen.queryByRole("searchbox") ?? screen.getByPlaceholderText(/search/i);

    selectFilterOption(/position/i, "PG", /^PG$/i);
    selectFilterOption(/status/i, "bench", /bench/i);
    fireEvent.change(searchInput, { target: { value: "CLE" } });

    expect(screen.getByText("Darius Garland")).toBeTruthy();
    expect(screen.queryByText("Jalen Brunson")).toBeNull();
    expect(screen.queryByText("Bam Adebayo")).toBeNull();

    // Switching status to starter with PG + CLE yields 0 rows
    selectFilterOption(/status/i, "starter", /starter/i);
    expect(screen.getByText(/no players match/i)).toBeTruthy();
  });

  it("Tier 2: filter combination yielding 0 rows shows empty-state message without crashing", async () => {
    await renderLoadedApp();
    const searchInput = screen.queryByRole("searchbox") ?? screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "ZZZZ-NO-MATCH" } });

    expect(screen.getByText(/no players match/i)).toBeTruthy();
  });

  it("Tier 2: clearing filters restores the full roster list", async () => {
    await renderLoadedApp();
    const searchInput = screen.queryByRole("searchbox") ?? screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "Jokic" } });
    expect(screen.queryByText("Jalen Brunson")).toBeNull();

    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByText("Jalen Brunson")).toBeTruthy();
    expect(screen.getByText("Nikola Jokic")).toBeTruthy();
  });

  it("Tier 2: PlayerDetail hides Spikes only when player has 0 games", async () => {
    const players = createFixturePlayersFile();
    const logs = createFixtureGameLogs().filter((l) => l.sleeperId !== "s-b2-1");
    vi.stubGlobal("fetch", createUiFetchStub({ players, logs }));

    await renderLoadedApp();
    fireEvent.click(screen.getByText("Bam Adebayo"));
    await waitFor(() => {
      expect(screen.getByText("Bam Adebayo")).toBeTruthy();
    });

    expect(screen.queryByLabelText(/spikes only/i)).toBeNull();
    expect(screen.getByText(/no games/i)).toBeTruthy();
  });

  it("Tier 2: LockAdvisorView Needs Decision shows empty-state message when all 9 starters are locked", async () => {
    const week = createFixtureWeeksFile().weeks[0]!;
    const logs = createFixtureGameLogs();
    const allStarterLocks = week.starters.map((sid) => {
      const log = logs.find((l) => l.sleeperId === sid && l.date >= week.startDate)!;
      return {
        sleeperId: sid,
        leg: week.leg,
        gameDate: log.date,
        lockedTotal: fantasyPoints(log).total,
        lockedAt: "2026-11-05T05:00:00Z",
        source: "user" as const,
      };
    });
    vi.stubGlobal(
      "fetch",
      createUiFetchStub({
        locks: { leagueId: week.leg ? "1358656481750171649" : "", locks: allStarterLocks },
      }),
    );

    await renderLoadedApp();
    fireEvent.click(screen.getByRole("button", { name: "Lock Advisor" }));
    await waitFor(() => {
      expect(screen.getByText(/Lock Advisor — Leg 3/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/i }));
    expect(screen.getByText(/no starters|all starters/i)).toBeTruthy();
  });
});
