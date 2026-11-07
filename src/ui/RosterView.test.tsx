// @vitest-environment jsdom
// Roster View tests — spec v1.0 §6.1: grouping, sorting, 0-game players.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());
import { RosterView } from "./RosterView.js";
import type { GameLog, PlayersFile } from "../data/types.js";

function makeLog(over: Partial<GameLog> & { sleeperId: string; date: string }): GameLog {
  return { opponent: "OPP", pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, source: "test", ...over };
}

const playersFile: PlayersFile = {
  asOf: "2026-11-07",
  leagueId: "1358656481750171649",
  players: [
    { sleeperId: "2441", name: "Walker Kessler", team: "LAL", positions: ["C"], rosterStatus: "starter" },
    { sleeperId: "2267", name: "Cade Cunningham", team: "DET", positions: ["PG"], rosterStatus: "starter" },
    { sleeperId: "2713", name: "Jared McCain", team: "OKC", positions: ["SG"], rosterStatus: "bench" },
    { sleeperId: "2456", name: "Keegan Murray", team: "SAC", positions: ["PF"], rosterStatus: "reserve" },
  ],
};

const logs: GameLog[] = [
  makeLog({ sleeperId: "2441", date: "2026-10-23", opponent: "LAC", pts: 22, reb: 8, ast: 3, stl: 3, blk: 6, tov: 1 }),
  makeLog({ sleeperId: "2441", date: "2026-11-01", opponent: "TOR", pts: 16, reb: 15, ast: 1, stl: 1, blk: 3, tov: 2 }),
  makeLog({ sleeperId: "2441", date: "2026-11-04", opponent: "@SAC", pts: 15, reb: 8, ast: 0, stl: 3, blk: 4, tov: 0 }),
  makeLog({ sleeperId: "2267", date: "2026-11-02", opponent: "CHA", pts: 33, reb: 5, ast: 7, stl: 5, blk: 0, tov: 3 }),
  makeLog({ sleeperId: "2713", date: "2026-11-06", opponent: "@MEM", pts: 21, reb: 5, ast: 0, stl: 4, blk: 1, tov: 1 }),
  // Keegan Murray (2456) has no logs.
];

function starterOrder(): string[] {
  const rows = screen.getAllByTestId(/^player-row-/);
  return rows
    .filter((r) => ["player-row-2441", "player-row-2267"].includes(r.getAttribute("data-testid") as string))
    .map((r) => (r.getAttribute("data-testid") as string).replace("player-row-", ""));
}

describe("RosterView", () => {
  it("groups players into Starters / Bench / Reserve / IR with the snapshot date", () => {
    render(<RosterView playersFile={playersFile} logs={logs} onSelect={() => {}} />);
    expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    expect(screen.getByText("Roster snapshot as of 2026-11-07")).toBeTruthy();
    expect(screen.getByText("Starters")).toBeTruthy();
    expect(screen.getByText("Bench")).toBeTruthy();
    expect(screen.getByText("Reserve / IR")).toBeTruthy();
    expect(screen.getByText("Walker Kessler")).toBeTruthy();
    expect(screen.getByText("Keegan Murray")).toBeTruthy();
  });

  it("sorts by Ceiling by default: Kessler (62.50) above Cade (61.75)", () => {
    render(<RosterView playersFile={playersFile} logs={logs} onSelect={() => {}} />);
    expect(starterOrder()).toEqual(["2441", "2267"]);
  });

  it("sorts by Median: Cade (61.75) above Kessler (48.25)", () => {
    render(<RosterView playersFile={playersFile} logs={logs} onSelect={() => {}} />);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "median" } });
    expect(starterOrder()).toEqual(["2267", "2441"]);
  });

  it("sorts by Last Game: Cade (61.75) above Kessler (46.00)", () => {
    render(<RosterView playersFile={playersFile} logs={logs} onSelect={() => {}} />);
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "lastGame" } });
    expect(starterOrder()).toEqual(["2267", "2441"]);
  });

  it("a 0-game player shows GP 0 and em dashes, never invented numbers", () => {
    render(<RosterView playersFile={playersFile} logs={logs} onSelect={() => {}} />);
    const row = screen.getByTestId("player-row-2456");
    expect(row.textContent).toContain("0");
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toMatch(/\d+\.\d{2}/);
  });

  it("tapping a player calls onSelect with their sleeperId", () => {
    const onSelect = vi.fn();
    render(<RosterView playersFile={playersFile} logs={logs} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Cade Cunningham"));
    expect(onSelect).toHaveBeenCalledWith("2267");
  });
});
