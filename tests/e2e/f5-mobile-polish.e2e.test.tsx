// @vitest-environment jsdom
// Opaque-box E2E tests for F5: Mobile Layout Polish & Responsive Styles.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fiveNumberSummary, analyzePlayer } from "../../src/analytics/index.js";
import type { GameLog } from "../../src/data/types.js";
import { App } from "../../src/ui/App.js";
import { BoxPlot } from "../../src/ui/BoxPlot.js";
import {
  createFixtureGameLogs,
  createFixturePlayersFile,
  createUiFetchStub,
} from "./fixtures/e2eFixtures.js";

const STYLES_PATH = resolve(process.cwd(), "src/ui/styles.css");

function extractMobileMediaBlocks(css: string): string {
  const blocks: string[] = [];
  const re = /@media\s*\(\s*max-width:\s*(640|768)px\s*\)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    blocks.push(css.slice(match.index, i));
  }
  return blocks.join("\n");
}

describe("F5: Mobile Layout Polish E2E", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal("fetch", createUiFetchStub());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  // Tier 1
  it("Tier 1: src/ui/styles.css defines mobile @media breakpoint rules (max-width: 640px or 768px)", () => {
    const css = readFileSync(STYLES_PATH, "utf-8");
    expect(extractMobileMediaBlocks(css).length).toBeGreaterThan(0);
  });

  it("Tier 1: filter/target rows wrap via flex-wrap: wrap in styles.css", () => {
    const css = readFileSync(STYLES_PATH, "utf-8");
    expect(css).toMatch(/flex-wrap:\s*wrap/);
  });

  it("Tier 1: interactive buttons and inputs enforce 40px+ touch targets inside mobile @media block", () => {
    const mobileCss = extractMobileMediaBlocks(readFileSync(STYLES_PATH, "utf-8"));
    expect(mobileCss).toMatch(/min-height:\s*(40|42|44|48)px/);
  });

  it("Tier 1: summary cards use a 2-column grid inside mobile @media block", () => {
    const mobileCss = extractMobileMediaBlocks(readFileSync(STYLES_PATH, "utf-8"));
    expect(mobileCss).toMatch(/grid-template-columns:\s*repeat\(\s*2\s*,/);
  });

  it("Tier 1: wide tables apply sticky first column (position: sticky) in styles.css", () => {
    const css = readFileSync(STYLES_PATH, "utf-8");
    expect(css).toMatch(/position:\s*sticky/);
  });

  it("Tier 1: BoxPlot renders responsive SVG with viewBox and readable Min/Q1/Median/Q3/Max/IQR readout", () => {
    const logs = createFixtureGameLogs();
    const analytics = analyzePlayer("s-c-1", logs);
    const summary = fiveNumberSummary(analytics.distribution.map((g) => g.total));

    render(<BoxPlot games={analytics.distribution} summary={summary} />);

    const svg = screen.getByTestId("boxplot-svg");
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    const readout = screen.getByTestId("boxplot-readout");
    expect(readout.textContent).toContain("Min");
    expect(readout.textContent).toContain("Median");
    expect(readout.textContent).toContain("IQR");
  });

  // Tier 2
  it("Tier 2: long player names render in App without breaking table structure", async () => {
    const players = createFixturePlayersFile();
    players.players[0]!.name = "Alexandros-Antetokounmpo-Gilgeous-Walker III";
    vi.stubGlobal("fetch", createUiFetchStub({ players }));

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Alexandros-Antetokounmpo-Gilgeous-Walker III")).toBeTruthy();
    });
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("Tier 2: BoxPlot with single game (identical min/max) renders without NaN in SVG coordinates", () => {
    const singleLog: GameLog[] = [
      {
        sleeperId: "s-f-1",
        date: "2026-11-04",
        opponent: "HOU",
        pts: 20,
        reb: 5,
        ast: 5,
        stl: 1,
        blk: 0,
        tov: 2,
        source: "e2e-fixture",
      },
    ];
    const analytics = analyzePlayer("s-f-1", singleLog);
    const summary = fiveNumberSummary(analytics.distribution.map((g) => g.total));

    render(<BoxPlot games={analytics.distribution} summary={summary} />);
    const svg = screen.getByTestId("boxplot-svg");
    expect(svg.innerHTML).not.toContain("NaN");
  });

  it("Tier 2: BoxPlot with 0 games (n = 0) renders small-N note without NaN or crashing, and fiveNumberSummary([]) returns null", () => {
    const analytics = analyzePlayer("s-missing", []);
    expect(fiveNumberSummary(analytics.distribution.map((g) => g.total))).toBeNull();

    render(
      <BoxPlot
        games={[]}
        summary={{ n: 0, min: 0, q1: 0, median: 0, q3: 0, max: 0, iqr: 0 }}
      />,
    );
    expect(screen.getByTestId("boxplot-small-n-note")).toBeTruthy();
    expect(screen.queryByTestId("boxplot-box-group")).toBeNull();
    const svg = screen.getByTestId("boxplot-svg");
    expect(svg.innerHTML).not.toContain("NaN");
  });

  it("Tier 2: narrow viewport App navigation tabs remain accessible in DOM", async () => {
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 });
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: /main navigation/i })).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: "Roster" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lock Advisor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Matchup" })).toBeTruthy();
  });

  it("Tier 2: src/ui/styles.css has valid balanced braces (no syntax corruption)", () => {
    const css = readFileSync(STYLES_PATH, "utf-8");
    let depth = 0;
    for (const ch of css) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
  });

  it("Tier 2: @media print rules are present and override dark-mode CSS vars and table clipping in src/ui/styles.css", () => {
    const css = readFileSync(STYLES_PATH, "utf-8");
    const printIdx = css.indexOf("@media print");
    expect(printIdx).toBeGreaterThan(-1);
    const printCss = css.slice(printIdx);
    expect(printCss).toContain("--accent:");
    expect(printCss).toContain("--text:");
    expect(printCss).toContain("--surface:");
    expect(printCss).toContain("overflow-x: visible");
    expect(printCss).toContain("min-width: 0");
  });

  it("Tier 2: styles.css defines :focus-visible outlines, 44px mobile tap targets, and opponent-breakdown-table width override", () => {
    const css = readFileSync(STYLES_PATH, "utf-8");
    expect(css).toMatch(/:focus-visible/);
    const mobileCss = extractMobileMediaBlocks(css);
    expect(mobileCss).toMatch(/min-height:\s*44px/);
    expect(mobileCss).toMatch(/min-width:\s*44px/);
    expect(mobileCss).toContain(".player-link");
    expect(mobileCss).toContain(".opponent-breakdown-table");
  });
});
