// @vitest-environment jsdom
// LockAdvisorView tests — Phase 3 v1.0 §4 & §7.2.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAll } from "../data/load.js";
import type { WeekRecord } from "../data/types.js";
import { LockAdvisorView } from "./LockAdvisorView.js";

afterEach(() => cleanup());

describe("LockAdvisorView — Leg 3 seed data", () => {
  const { players, logs: allLogs, weeks, locks } = loadAll();
  const logs = allLogs.filter((l) => l.date <= "2026-11-06");
  const baseLeg3 = weeks.weeks[0] as WeekRecord;
  const leg3: WeekRecord = {
    ...baseLeg3,
    remainingGames: {
      "2267": ["2026-11-08"],
      "4737": ["2026-11-08"],
      "4750": ["2026-11-08"],
      "2714": ["2026-11-07"],
      "2181": ["2026-11-07"],
      "1752": ["2026-11-08"],
      "1739": ["2026-11-08"],
      "2441": ["2026-11-08"],
      "2713": ["2026-11-07"],
      "1074": ["2026-11-08"],
      "2131": ["2026-11-08"],
      "1998": [],
      "2583": ["2026-11-08"],
      "4742": ["2026-11-07", "2026-11-08"],
      "2456": [],
    },
  };


  it("renders all 9 starters in slot order with EV numbers, badges, and model assumptions", () => {
    render(
      <LockAdvisorView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        onSelectPlayer={() => {}}
      />,
    );

    expect(screen.getByText("Lock Advisor — Leg 3")).toBeTruthy();
    expect(screen.getByTestId("advisor-assumptions").textContent).toContain(
      "Sequential first-beat stopping rule",
    );

    // Check Kessler (2441): unlocked at 38.00, 1 game left, rideEV +2.00, RIDE
    const kesslerRow = screen.getByTestId("advisor-row-2441").textContent ?? "";
    expect(kesslerRow).toContain("Walker Kessler");
    expect(kesslerRow).toContain("38.00");
    expect(kesslerRow).toContain("UNLOCKED");
    expect(kesslerRow).toContain("60%");
    expect(kesslerRow).toContain("+10.08");
    expect(kesslerRow).toContain("-10.13");
    expect(screen.getByTestId("ride-ev-2441").textContent).toBe("+2.00");
    expect(screen.getByTestId("rec-2441").textContent).toContain("RIDE");

    // Check Markkanen (1752): locked at 47.50, latest 33.50 -> +14.00 gain vs latest
    const markkanenRow = screen.getByTestId("advisor-row-1752").textContent ?? "";
    expect(markkanenRow).toContain("Lauri Markkanen");
    expect(markkanenRow).toContain("47.50");
    expect(markkanenRow).toContain("LOCKED");
    expect(screen.getByTestId("lock-gain-1752").textContent).toContain("vs latest (33.50): +14.00");

    // Check Kyshawn George (2714): unlocked at 57.00 (ceiling), rideEV negative -> LOCK + near ceiling note
    expect(screen.getByTestId("rec-2714").textContent).toContain("LOCK");
    expect(screen.getByTestId("rec-2714").textContent).toContain("Near ceiling");
  });

  it("calls onSelectPlayer when a starter name is clicked", () => {
    const onSelect = vi.fn();
    render(
      <LockAdvisorView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        onSelectPlayer={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("Walker Kessler"));
    expect(onSelect).toHaveBeenCalledWith("2441");
  });
});
