// @vitest-environment jsdom
// Player Detail tests — spec v1.0 §6.2: summary cards, Target Score
// Explorer beat-rate math, distribution + breakdown, and the rule that
// the UI never reads GameLog.expectedTotal.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());
import { PlayerDetail } from "./PlayerDetail.js";
import { loadGameLogs } from "../data/load.js";
import type { GameLog, Player } from "../data/types.js";

function makeLog(over: Partial<GameLog> & { sleeperId: string; date: string }): GameLog {
  return { opponent: "OPP", pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, source: "test", ...over };
}

const kessler: Player = {
  sleeperId: "2441",
  name: "Walker Kessler",
  team: "LAL",
  positions: ["C"],
  rosterStatus: "starter",
};

/** Kessler's real 9-game lines through Nov 4 — totals 42.75, 62.50, 12.75,
 *  28.00, 32.75, 45.25, 48.25, 43.75, 46.00. Last game (Nov 4) = 46.00. */
const kesslerLogs: GameLog[] = [
  makeLog({ sleeperId: "2441", date: "2026-10-21", opponent: "GSW", pts: 26, reb: 9, ast: 1, stl: 0, blk: 2, tov: 2 }),
  makeLog({ sleeperId: "2441", date: "2026-10-23", opponent: "LAC", pts: 22, reb: 8, ast: 3, stl: 3, blk: 6, tov: 1 }),
  makeLog({ sleeperId: "2441", date: "2026-10-25", opponent: "@UTA", pts: 2, reb: 7, ast: 0, stl: 0, blk: 1, tov: 1 }),
  makeLog({ sleeperId: "2441", date: "2026-10-27", opponent: "POR", pts: 13, reb: 8, ast: 0, stl: 1, blk: 2, tov: 4 }),
  makeLog({ sleeperId: "2441", date: "2026-10-28", opponent: "@LAC", pts: 11, reb: 9, ast: 1, stl: 2, blk: 1, tov: 0 }),
  makeLog({ sleeperId: "2441", date: "2026-10-30", opponent: "@GSW", pts: 10, reb: 13, ast: 2, stl: 0, blk: 5, tov: 1 }),
  makeLog({ sleeperId: "2441", date: "2026-11-01", opponent: "TOR", pts: 16, reb: 15, ast: 1, stl: 1, blk: 3, tov: 2 }),
  makeLog({ sleeperId: "2441", date: "2026-11-02", opponent: "MIA", pts: 15, reb: 15, ast: 2, stl: 2, blk: 0, tov: 1 }),
  makeLog({ sleeperId: "2441", date: "2026-11-04", opponent: "@SAC", pts: 15, reb: 8, ast: 0, stl: 3, blk: 4, tov: 0 }),
];

describe("PlayerDetail — Kessler 9-game fixture", () => {
  it("summary cards show ceiling / median / floor / last game / GP, mean only as 'Mean (ref only)'", () => {
    render(<PlayerDetail player={kessler} logs={kesslerLogs} onBack={() => {}} />);
    const cards = screen.getByTestId("summary-cards").textContent ?? "";
    expect(cards).toContain("Ceiling");
    expect(cards).toContain("62.50");
    expect(cards).toContain("Median");
    expect(cards).toContain("43.75");
    expect(cards).toContain("Floor");
    expect(cards).toContain("12.75");
    expect(cards).toContain("Mean (ref only)");
    expect(cards).toContain("40.22");
    expect(screen.getByText("GP")).toBeTruthy();
    expect(cards).toContain("9");
  });

  it("target explorer starts at lastGame (46.00) with beat-rate 2 of 9 (22%)", () => {
    render(<PlayerDetail player={kessler} logs={kesslerLogs} onBack={() => {}} />);
    const input = screen.getByLabelText("Target score") as HTMLInputElement;
    expect(input.value).toBe("46.00");
    const ev = screen.getByTestId("target-evaluation").textContent ?? "";
    expect(ev).toContain("2 of 9 games (22%)");
    expect(ev).toContain("Max Upside +16.50");
    expect(ev).toContain("Max Downside -33.25");
    // Beating games: 62.50 (+16.50), 48.25 (+2.25) — strict >, so the 46.00 game itself is not listed.
    expect(ev).toContain("10-23 LAC — 62.50 (+16.50)");
    expect(ev).toContain("11-01 TOR — 48.25 (+2.25)");
    expect(ev).not.toContain("11-04");
  });

  it("clicking a score chip retargets: 62.50 is beaten by 0 of 9 games", () => {
    render(<PlayerDetail player={kessler} logs={kesslerLogs} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "62.50" }));
    const ev = screen.getByTestId("target-evaluation").textContent ?? "";
    expect(ev).toContain("0 of 9 games (0%)");
    expect(ev).toContain("No game beat this target.");
  });

  it("distribution defaults High → Low and the 6-part breakdown sums to total", () => {
    render(<PlayerDetail player={kessler} logs={kesslerLogs} onBack={() => {}} />);
    const games = screen.getAllByTestId(/^game-20/);
    expect(games[0]?.getAttribute("data-testid")).toBe("game-2026-10-23"); // 62.50 first
    const breakdown = screen.getByTestId("breakdown-2026-10-23").textContent ?? "";
    // 22.00 + 10.00 + 4.50 + 27.00 + 0.00 − 1.00 = 62.50
    expect(breakdown).toContain("22.00");
    expect(breakdown).toContain("10.00");
    expect(breakdown).toContain("4.50");
    expect(breakdown).toContain("27.00");
    expect(breakdown).toContain("-1.00");
    expect(breakdown).toContain("= 62.50");
  });

  it("Latest → Oldest toggle puts the Nov 4 game first; Top 3 spikes are badged", () => {
    render(<PlayerDetail player={kessler} logs={kesslerLogs} onBack={() => {}} />);
    fireEvent.click(screen.getByText("Latest → Oldest"));
    const games = screen.getAllByTestId(/^game-20/);
    expect(games[0]?.getAttribute("data-testid")).toBe("game-2026-11-04");
    const spikes = screen.getAllByText(/SPIKE/);
    expect(spikes).toHaveLength(3);
    expect(spikes[0]?.textContent).toContain("stocks");
  });

  it("back button calls onBack", () => {
    const onBack = vi.fn();
    render(<PlayerDetail player={kessler} logs={kesslerLogs} onBack={onBack} />);
    fireEvent.click(screen.getByText("← Roster"));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("PlayerDetail — UI never reads expectedTotal", () => {
  it("a wrong expectedTotal (999) changes nothing displayed", () => {
    const avdija: Player = {
      sleeperId: "2181",
      name: "Deni Avdija",
      team: "POR",
      positions: ["PF"],
      rosterStatus: "starter",
    };
    const logs: GameLog[] = [
      makeLog({
        sleeperId: "2181",
        date: "2026-11-06",
        opponent: "LAL",
        pts: 22, reb: 9, ast: 11, stl: 2, blk: 0, tov: 8,
        source: "seed",
        expectedTotal: 999,
      }),
    ];
    render(<PlayerDetail player={avdija} logs={logs} onBack={() => {}} />);
    expect(document.body.textContent).toContain("49.75");
    expect(document.body.textContent).not.toContain("999");
  });
});

describe("PlayerDetail — 0-game player", () => {
  it("shows em dashes and a 'no games' note, no target explorer", () => {
    const keegan: Player = {
      sleeperId: "2456",
      name: "Keegan Murray",
      team: "SAC",
      positions: ["PF"],
      rosterStatus: "reserve",
    };
    render(<PlayerDetail player={keegan} logs={[]} onBack={() => {}} />);
    expect(screen.getByText("No games logged yet for this player.")).toBeTruthy();
    expect(screen.queryByLabelText("Target score")).toBeNull();
  });
});

describe("PlayerDetail — technical/flagrant fouls and prop-change reset", () => {
  const coby: Player = {
    sleeperId: "1945",
    name: "Coby White",
    team: "CHA",
    positions: ["PG", "SG"],
    rosterStatus: "bench",
  };
  const cobyLogs: GameLog[] = [
    makeLog({
      sleeperId: "1945",
      date: "2026-11-02",
      opponent: "DET",
      pts: 30,
      reb: 6,
      ast: 5,
      stl: 1,
      blk: 0,
      tov: 3,
      tf: 1,
    }),
  ];

  it("displays non-zero tf in the raw stat line alongside Penalties breakdown", () => {
    render(<PlayerDetail player={coby} logs={cobyLogs} onBack={() => {}} />);
    const gameRow = screen.getByTestId("game-2026-11-02").textContent ?? "";
    expect(gameRow).toContain("3 tov · 1 tf");
    expect(gameRow).toContain("Penalties -5.00");
  });

  it("resets targetText and distSort when player prop changes without remount", () => {
    const { rerender } = render(
      <PlayerDetail player={kessler} logs={[...kesslerLogs, ...cobyLogs]} onBack={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText("Target score"), { target: { value: "50.00" } });
    fireEvent.click(screen.getByText("Latest → Oldest"));
    expect((screen.getByLabelText("Target score") as HTMLInputElement).value).toBe("50.00");

    rerender(<PlayerDetail player={coby} logs={[...kesslerLogs, ...cobyLogs]} onBack={() => {}} />);
    expect((screen.getByLabelText("Target score") as HTMLInputElement).value).toBe("43.00");
  });
});

describe("PlayerDetail — Phase 4 time-window filtering & Box Plot integration", () => {
  const kessler10Logs = loadGameLogs("data/game-logs.json").filter(
    (l) => l.sleeperId === "2441",
  );

  it("defaults to All season (10 GP) and updates summary cards, box plot readout, target input, and game list when switching to Last week (4 GP)", () => {
    render(
      <PlayerDetail
        player={kessler}
        logs={kessler10Logs}
        asOf="2026-11-07"
        bankedScore={38}
        onBack={() => {}}
      />,
    );

    // Default: All season (10 GP)
    expect(screen.getByText(/Starter · All season/)).toBeTruthy();
    expect(screen.getByTestId("summary-cards").textContent).toContain("10");
    expect(screen.getByTestId("boxplot-readout").textContent).toContain(
      "Min 12.75Q1 34.06Median 43.25Q3 45.81Max 62.50IQR 11.75",
    );
    expect(screen.getAllByTestId(/^game-2026/)).toHaveLength(10);

    // Custom target before switching window
    fireEvent.change(screen.getByLabelText("Target score"), {
      target: { value: "50.00" },
    });
    expect((screen.getByLabelText("Target score") as HTMLInputElement).value).toBe(
      "50.00",
    );

    // Switch to Last week ([2026-10-31, 2026-11-07] -> 4 games: Nov 1, Nov 2, Nov 4, Nov 6)
    fireEvent.click(screen.getByTestId("window-chip-last-week"));

    expect(screen.getByText(/Starter · Last week/)).toBeTruthy();
    const cards = screen.getByTestId("summary-cards").textContent ?? "";
    expect(cards).toContain("48.25"); // ceiling
    expect(cards).toContain("44.88"); // median
    expect(cards).toContain("38.00"); // floor & last game
    expect(cards).toContain("4"); // GP

    expect(screen.getByTestId("boxplot-readout").textContent).toContain(
      "Min 38.00Q1 42.31Median 44.88Q3 46.56Max 48.25IQR 4.25",
    );
    // Target input reset to windowed lastGame (38.00 on Nov 6)
    expect((screen.getByLabelText("Target score") as HTMLInputElement).value).toBe(
      "38.00",
    );
    expect(screen.getAllByTestId(/^game-2026/)).toHaveLength(4);
  });

  it("shows 'No games logged in this window.' when a player has season games outside the selected window, and resets window to All season on player change", () => {
    const earlyOnlyLogs: GameLog[] = [
      makeLog({
        sleeperId: "2441",
        date: "2026-10-21",
        opponent: "GSW",
        pts: 26,
        reb: 9,
        ast: 1,
        stl: 0,
        blk: 2,
        tov: 2,
      }),
    ];
    const coby: Player = {
      sleeperId: "1945",
      name: "Coby White",
      team: "CHA",
      positions: ["PG", "SG"],
      rosterStatus: "bench",
    };
    const cobyLogs: GameLog[] = [
      makeLog({
        sleeperId: "1945",
        date: "2026-10-22",
        opponent: "DET",
        pts: 30,
        reb: 6,
        ast: 5,
        stl: 1,
        blk: 0,
        tov: 3,
      }),
    ];

    const { rerender } = render(
      <PlayerDetail
        player={kessler}
        logs={[...earlyOnlyLogs, ...cobyLogs]}
        asOf="2026-11-07"
        onBack={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("window-chip-last-week"));
    expect(screen.getByText("No games logged in this window.")).toBeTruthy();

    // Switching player resets window to All season
    rerender(
      <PlayerDetail
        player={coby}
        logs={[...earlyOnlyLogs, ...cobyLogs]}
        asOf="2026-11-07"
        onBack={() => {}}
      />,
    );
    expect(screen.getByText(/Bench · All season/)).toBeTruthy();
    expect(screen.getByTestId("summary-cards").textContent).toContain("45.00");
  });
});
