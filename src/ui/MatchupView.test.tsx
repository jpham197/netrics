// @vitest-environment jsdom
// MatchupView tests — Phase 3 v1.0 §5, §6, §7.3 & Phase 5 §8.2.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAll } from "../data/load.js";
import type { WeekRecord } from "../data/types.js";
import type { LiveMatchup } from "../sleeper/liveMatchup.js";
import { MatchupView } from "./MatchupView.js";

afterEach(() => cleanup());

const offlineFetch = vi.fn(async () => {
  throw new Error("Offline in unit test");
});

describe("MatchupView — Leg 3 seed data", () => {
  const { players, logs, weeks, locks } = loadAll();
  const leg3 = weeks.weeks[0] as WeekRecord;

  it("renders scoreboard totals (407.25 vs 317.25, +90.00), bounds, Bench Swing recommendations, and offline snapshot status when fetchLive rejects", async () => {
    render(
      <MatchupView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        fetchLive={offlineFetch}
      />,
    );

    expect(screen.getByTestId("user-total").textContent).toBe("407.25");
    expect(screen.getByTestId("opponent-total").textContent).toBe("317.25");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("+90.00");
    expect(screen.getByTestId("matchup-live-status").textContent).toContain(
      "Offline · showing saved scores as of",
    );

    // Locked Markkanen (1752) has both bestCase and worstCase = 47.50
    const markkanenRow = screen.getByTestId("bound-row-1752").textContent ?? "";
    expect(markkanenRow).toContain("47.50");
    expect(markkanenRow).not.toContain("2.00");

    // Bench Swing table shows Paul George (1074, 42.25) over Kessler (slot 7 UTIL, +4.25) and McCain (slot 8 UTIL, +1.00)
    const swingKessler = screen.getByTestId("swing-row-1074-7").textContent ?? "";
    expect(swingKessler).toContain("Paul George");
    expect(swingKessler).toContain("42.25");
    expect(swingKessler).toContain("UTIL");
    expect(swingKessler).toContain("Walker Kessler");
    expect(swingKessler).toContain("+4.25");

    const swingMcCain = screen.getByTestId("swing-row-1074-8").textContent ?? "";
    expect(swingMcCain).toContain("Jared McCain");
    expect(swingMcCain).toContain("+1.00");
  });

  it("updates opponent total and margin when opponent score override input is edited", () => {
    render(
      <MatchupView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        fetchLive={offlineFetch}
      />,
    );

    const input = screen.getByLabelText("Opponent score override") as HTMLInputElement;
    expect(input.value).toBe("317.25");

    fireEvent.change(input, { target: { value: "410.00" } });
    expect(screen.getByTestId("opponent-total").textContent).toBe("410.00");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("-2.75");

    fireEvent.click(screen.getByText("Reset (317.25)"));
    expect(screen.getByTestId("opponent-total").textContent).toBe("317.25");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("+90.00");
  });

  it("calls onSelectPlayer when a player link is clicked in MatchupView", () => {
    const onSelect = vi.fn();
    render(
      <MatchupView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        onSelectPlayer={onSelect}
        fetchLive={offlineFetch}
      />,
    );
    fireEvent.click(screen.getAllByText("Paul George")[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("1074");
  });

  it("resolves live Sleeper matchup: keeps verified userTotal (407.25) with Sleeper live sub-label, updates opponentTotal and margin, and renders live opponent starters", async () => {
    const weekWithOppPlayers: WeekRecord = {
      ...leg3,
      opponentPlayers: [
        { sleeperId: "3001", name: "Nikola Jokic", position: "C", team: "DEN", points: 55.0 },
      ],
    };

    const liveFixture: LiveMatchup = {
      leg: 3,
      matchupId: 4,
      fetchedAt: "2026-11-07T20:15:00.000Z",
      userPoints: 399.5, // e.g. lagging behind verified 407.25
      opponentRosterId: 8,
      opponentPoints: 350.0,
      opponentStarters: [
        { sleeperId: "3001", points: 64.25 },
        { sleeperId: "9999", points: 31.5 },
      ],
      userStarters: [],
    };

    const mockFetchLive = vi.fn(async () => liveFixture);

    render(
      <MatchupView
        week={weekWithOppPlayers}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        fetchLive={mockFetchLive}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("matchup-live-status").textContent).toContain(
        "Live · fetched 2026-11-07T20:15:00.000Z",
      ),
    );

    // Primary user-total stays verified 407.25; Sleeper live shown in subtitle
    expect(screen.getByTestId("user-total").textContent).toBe("407.25");
    expect(screen.getByTestId("matchup-scoreboard").textContent).toContain("Sleeper live: 399.50");

    // Opponent total and margin update to live.opponentPoints (350.00 -> margin +57.25)
    expect(screen.getByTestId("opponent-total").textContent).toBe("350.00");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("+57.25");

    // Opponent breakdown table resolves 3001 -> Nikola Jokic and falls back to Player #9999
    const oppTable = screen.getByTestId("opponent-breakdown-table").textContent ?? "";
    expect(oppTable).toContain("Nikola Jokic");
    expect(oppTable).toContain("C · DEN");
    expect(oppTable).toContain("64.25");
    expect(oppTable).toContain("Player #9999");
    expect(oppTable).toContain("31.50");

    // Manual override takes precedence over live opponent points, and Reset restores live baseline (350.00)
    const input = screen.getByLabelText("Opponent score override") as HTMLInputElement;
    expect(input.value).toBe("350.00");
    fireEvent.change(input, { target: { value: "420.00" } });
    expect(screen.getByTestId("opponent-total").textContent).toBe("420.00");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("-12.75");

    fireEvent.click(screen.getByText("Reset (350.00)"));
    expect(screen.getByTestId("opponent-total").textContent).toBe("350.00");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("+57.25");
  });
});

