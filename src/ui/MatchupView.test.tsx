// @vitest-environment jsdom
// MatchupView tests — Phase 3 v1.0 §5, §6, §7.3.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAll } from "../data/load.js";
import type { WeekRecord } from "../data/types.js";
import { MatchupView } from "./MatchupView.js";

afterEach(() => cleanup());

describe("MatchupView — Leg 3 seed data", () => {
  const { players, logs, weeks, locks } = loadAll();
  const leg3 = weeks.weeks[0] as WeekRecord;

  it("renders scoreboard totals (407.25 vs 317.25, +90.00), bounds, and Bench Swing recommendations", () => {
    render(
      <MatchupView
        week={leg3}
        players={players.players}
        logs={logs}
        locks={locks.locks}
      />,
    );

    expect(screen.getByTestId("user-total").textContent).toBe("407.25");
    expect(screen.getByTestId("opponent-total").textContent).toBe("317.25");
    expect(screen.getByTestId("matchup-margin").textContent).toBe("+90.00");

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
      />,
    );
    fireEvent.click(screen.getAllByText("Paul George")[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("1074");
  });
});
