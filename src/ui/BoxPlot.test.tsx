// @vitest-environment jsdom
// Unit tests for BoxPlot component — spec v1.0 §7.5.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BoxPlot } from "./BoxPlot.js";
import { fiveNumberSummary, scoreLogs } from "../analytics/index.js";
import type { GameLog } from "../data/types.js";

afterEach(() => cleanup());

function makeLog(date: string, pts: number): GameLog {
  return {
    sleeperId: "2441",
    date,
    opponent: "OPP",
    pts,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    source: "test",
  };
}

describe("BoxPlot component (spec §7.5)", () => {
  it("renders box, whiskers, median line, game dots, and accessible readout when N >= 3", () => {
    const logs = [
      makeLog("2026-11-01", 20), // 20.00
      makeLog("2026-11-02", 30), // 30.00
      makeLog("2026-11-04", 40), // 40.00 (40+ pts bonus +2 => 42.00)
      makeLog("2026-11-06", 50), // 50.00 (40+ pts +2, 50+ pts +2 => 54.00)
    ];
    const games = scoreLogs(logs);
    const summary = fiveNumberSummary(games.map((g) => g.total));
    expect(summary).not.toBeNull();

    render(<BoxPlot games={games} summary={summary!} />);

    expect(screen.getByTestId("boxplot-box")).toBeTruthy();
    expect(screen.getByTestId("boxplot-median")).toBeTruthy();
    expect(screen.getByTestId("boxplot-whisker-min")).toBeTruthy();
    expect(screen.getByTestId("boxplot-whisker-max")).toBeTruthy();
    expect(screen.queryByTestId("boxplot-small-n-note")).toBeNull();

    // 4 dots rendered, top 3 are spikes
    const dots = screen.getAllByTestId(/^boxplot-dot-2026/);
    expect(dots).toHaveLength(4);
    const spikeDots = dots.filter((d) =>
      d.getAttribute("class")?.includes("boxplot-dot-spike"),
    );
    expect(spikeDots).toHaveLength(3);

    const readout = screen.getByTestId("boxplot-readout").textContent ?? "";
    expect(readout).toContain("Min 20.00");
    expect(readout).toContain("Q1 27.50");
    expect(readout).toContain("Median 35.50");
    expect(readout).toContain("Q3 43.75");
    expect(readout).toContain("Max 52.00");
    expect(readout).toContain("IQR 16.25");
  });

  it("omits box/whiskers and shows small-N note when N < 3 (1-2 games)", () => {
    const logs = [makeLog("2026-11-01", 25), makeLog("2026-11-03", 35)];
    const games = scoreLogs(logs);
    const summary = fiveNumberSummary(games.map((g) => g.total))!;

    render(<BoxPlot games={games} summary={summary} />);

    expect(screen.queryByTestId("boxplot-box")).toBeNull();
    expect(screen.getByTestId("boxplot-small-n-note").textContent).toBe(
      "Not enough games for a box plot — showing individual games.",
    );
    expect(screen.getAllByTestId(/^boxplot-dot-2026/)).toHaveLength(2);
  });

  it("guards against zero span (min === max) without NaN coordinates", () => {
    const logs = [makeLog("2026-11-01", 30), makeLog("2026-11-02", 30), makeLog("2026-11-04", 30)];
    const games = scoreLogs(logs);
    const summary = fiveNumberSummary(games.map((g) => g.total))!;
    expect(summary.min).toBe(30);
    expect(summary.max).toBe(30);

    render(<BoxPlot games={games} summary={summary} />);

    const dot = screen.getByTestId("boxplot-dot-2026-11-01");
    const cx = Number(dot.getAttribute("cx"));
    expect(Number.isFinite(cx)).toBe(true);
    expect(cx).toBeCloseTo(320, 1); // centered in 640px SVG
  });

  it("draws Banked (B) vertical marker when B is inside [min, max], and text note when outside", () => {
    const logs = [
      makeLog("2026-11-01", 20),
      makeLog("2026-11-02", 30),
      makeLog("2026-11-04", 38),
    ];
    const games = scoreLogs(logs);
    const summary = fiveNumberSummary(games.map((g) => g.total))!;

    const { rerender } = render(
      <BoxPlot games={games} summary={summary} bankedScore={30} />,
    );
    expect(screen.getByTestId("boxplot-banked-marker").textContent).toContain(
      "Banked (30.00)",
    );
    expect(screen.queryByTestId("boxplot-banked-out-note")).toBeNull();

    // Re-render with bankedScore at exact min (20.00): label x is clamped >= 64
    rerender(<BoxPlot games={games} summary={summary} bankedScore={20} />);
    const labelAtMin = screen
      .getByTestId("boxplot-banked-marker")
      .querySelector("text");
    expect(Number(labelAtMin?.getAttribute("x"))).toBeGreaterThanOrEqual(64);

    // Re-render with bankedScore outside [20.00, 38.00]
    rerender(<BoxPlot games={games} summary={summary} bankedScore={47.5} />);
    expect(screen.queryByTestId("boxplot-banked-marker")).toBeNull();
    expect(screen.getByTestId("boxplot-banked-out-note").textContent).toBe(
      "Banked (47.50) is outside the windowed range (20.00–38.00).",
    );
  });
});

