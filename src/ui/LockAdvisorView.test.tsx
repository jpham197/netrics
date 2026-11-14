// @vitest-environment jsdom
// LockAdvisorView tests — Phase 3 v1.0 §4 & §7.2.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("filters by All, Needs Decision, and Locked chips with aria-pressed state", () => {
    render(
      <LockAdvisorView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        onSelectPlayer={() => {}}
      />,
    );

    const allChip = screen.getByTestId("advisor-filter-all");
    const decisionChip = screen.getByTestId("advisor-filter-decision");
    const lockedChip = screen.getByTestId("advisor-filter-locked");

    expect(allChip.getAttribute("aria-pressed")).toBe("true");
    expect(decisionChip.getAttribute("aria-pressed")).toBe("false");
    expect(lockedChip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getAllByTestId(/^advisor-row-/)).toHaveLength(9);

    // Needs Decision: only evaluation.status === "DECISION" rows (Markkanen 1752 is LOCKED -> excluded)
    fireEvent.click(decisionChip);
    expect(allChip.getAttribute("aria-pressed")).toBe("false");
    expect(decisionChip.getAttribute("aria-pressed")).toBe("true");
    expect(lockedChip.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("advisor-row-1752")).toBeNull();
    expect(screen.getByTestId("advisor-row-2441")).toBeTruthy();
    expect(screen.getByTestId("advisor-row-2714")).toBeTruthy();
    const decisionRows = screen.getAllByTestId(/^advisor-row-/);
    for (const row of decisionRows) {
      expect(row.textContent).toContain("UNLOCKED");
    }

    // Locked: only evaluation.status === "LOCKED" rows (Markkanen 1752 included, Kessler 2441 excluded)
    fireEvent.click(lockedChip);
    expect(allChip.getAttribute("aria-pressed")).toBe("false");
    expect(decisionChip.getAttribute("aria-pressed")).toBe("false");
    expect(lockedChip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("advisor-row-1752")).toBeTruthy();
    expect(screen.queryByTestId("advisor-row-2441")).toBeNull();
    const lockedRows = screen.getAllByTestId(/^advisor-row-/);
    for (const row of lockedRows) {
      expect(row.textContent).toContain("LOCKED");
    }

    // Back to All
    fireEvent.click(allChip);
    expect(allChip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByTestId(/^advisor-row-/)).toHaveLength(9);
  });

  it("shows advisor-empty when no rows match the selected filter", () => {
    const noRemainingWeek: WeekRecord = {
      ...leg3,
      remainingGames: {},
    };
    render(
      <LockAdvisorView
        week={noRemainingWeek}
        players={players.players}
        logs={logs}
        locks={[]}
        onSelectPlayer={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("advisor-filter-locked"));
    expect(screen.getByTestId("advisor-empty")).toBeTruthy();
    expect(screen.queryByTestId("advisor-table")).toBeNull();

    fireEvent.click(screen.getByTestId("advisor-filter-decision"));
    expect(screen.getByTestId("advisor-empty")).toBeTruthy();
    expect(screen.queryByTestId("advisor-table")).toBeNull();

    fireEvent.click(screen.getByTestId("advisor-reset-filters"));
    expect(screen.queryByTestId("advisor-empty")).toBeNull();
    expect(screen.getByTestId("advisor-table")).toBeTruthy();
    for (const th of Array.from(document.querySelectorAll("th"))) {
      expect(th.getAttribute("scope")).toBe("col");
    }
  });

  it("shows visible 'Copy failed' feedback with role='status' when clipboard fails", async () => {
    vi.stubGlobal("navigator", {});
    render(
      <LockAdvisorView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        onSelectPlayer={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("copy-advisor-summary"));
    await waitFor(() => {
      const feedback = document.querySelector(".export-feedback");
      expect(feedback?.getAttribute("role")).toBe("status");
      expect(feedback?.getAttribute("aria-live")).toBe("polite");
      expect(feedback?.textContent).toBe("Copy failed");
    });
  });

  it("copies Lock Advisor summary to clipboard and shows Copied! feedback", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(
      <LockAdvisorView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
        onSelectPlayer={() => {}}
      />,
    );

    const btn = screen.getByTestId("copy-advisor-summary");
    expect(btn.textContent).toBe("Copy Summary");
    fireEvent.click(btn);

    await vi.waitFor(() => expect(btn.textContent).toBe("Copied!"));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0]?.[0] as string;
    expect(copiedText).toContain("Lock Advisor — Leg 3");
    expect(copiedText).toContain("Walker Kessler");
    expect(copiedText.toLowerCase()).not.toContain("mean");

    vi.unstubAllGlobals();
  });
});
