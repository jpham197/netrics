// @vitest-environment jsdom
// Tier 5 Adversarial Frontend E2E Tests (Phase 2).
// Covers edge cases in exportShare.ts, BoxPlot.tsx, RosterView.tsx,
// LockAdvisorView.tsx, MatchupView.tsx, App.tsx, and PlayerDetail.tsx.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LockDecisionEvaluation,
  MatchupEvaluation,
  StarterAdvisorRow,
} from "../../src/advisor/index.js";
import { fiveNumberSummary, type PlayerAnalytics } from "../../src/analytics/index.js";
import {
  LEAGUE_ID,
  type GameLog,
  type Player,
  type PlayersFile,
  type WeekRecord,
} from "../../src/data/types.js";
import { fantasyPoints } from "../../src/scoring/index.js";
import type { LiveMatchup } from "../../src/sleeper/liveMatchup.js";
import { App } from "../../src/ui/App.js";
import { BoxPlot } from "../../src/ui/BoxPlot.js";
import {
  buildPlayerLogsCsv,
  buildRosterCsv,
  downloadCsv,
  formatLockAdvisorSummary,
  formatMatchupSummary,
} from "../../src/ui/exportShare.js";
import { LockAdvisorView } from "../../src/ui/LockAdvisorView.js";
import { MatchupView } from "../../src/ui/MatchupView.js";
import { PlayerDetail } from "../../src/ui/PlayerDetail.js";
import { RosterView } from "../../src/ui/RosterView.js";
import {
  createFixtureGameLogs,
  createFixtureLocksFile,
  createFixturePlayersFile,
  createFixtureWeeksFile,
  createUiFetchStub,
} from "./fixtures/e2eFixtures.js";

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    sleeperId: "p-1",
    name: "Test Player",
    team: "TST",
    positions: ["PG"],
    rosterStatus: "starter",
    ...overrides,
  };
}

function makeLog(overrides: Partial<GameLog> = {}): GameLog {
  return {
    sleeperId: "p-1",
    date: "2026-11-01",
    opponent: "OPP",
    pts: 20,
    reb: 5,
    ast: 5,
    stl: 1,
    blk: 0,
    tov: 2,
    source: "tier5-test",
    ...overrides,
  };
}

function makeWeek(overrides: Partial<WeekRecord> = {}): WeekRecord {
  return {
    leg: 3,
    startDate: "2026-11-02",
    endDate: "2026-11-08",
    matchupId: 1,
    opponentRosterId: 2,
    opponentName: "Rival Squad",
    opponentPoints: 250,
    opponentAsOf: "2026-11-05",
    starters: ["p-1"],
    bench: [],
    reserve: [],
    remainingGames: {},
    ...overrides,
  };
}

describe("Tier 5 Adversarial Frontend E2E", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // T5-F1
  it("T5-F1: exportShare CSV handles RFC-4180 CR/LF/CRLF/quotes/formulas, empty inputs, missing summary, reserve status, and omits mean/expectedTotal", () => {
    const reservePlayer = makePlayer({
      sleeperId: "p-res",
      name: 'Doe, "Ace"\r\n=SUM(A1)',
      team: "NY\nK",
      positions: ["PF", "C"],
      rosterStatus: "reserve",
    });

    expect(buildRosterCsv([])).toBe("Player,Team,Pos,Status,Ceiling,Median,Floor,Last Game,GP");
    expect(buildPlayerLogsCsv(reservePlayer, [])).toBe(
      "Date,Opponent,Total,Pts,Reb,Ast,Stl,Blk,Tov,TF,FF,Source",
    );

    const logWithExpected = makeLog({
      sleeperId: "p-res",
      date: "2026-11-03",
      opponent: "BOS\rMIL",
      source: 'espn,"quote"\r\nline',
      expectedTotal: 999.99,
    });
    const scoredTotal = fantasyPoints(logWithExpected).total;

    const fakeAnalytics: PlayerAnalytics = {
      playerId: "p-res",
      distribution: [
        {
          log: logWithExpected,
          score: fantasyPoints(logWithExpected),
          total: scoredTotal,
          isSpike: false,
        },
      ],
      chronological: [],
      summary: {
        gamesPlayed: 1,
        ceiling: 40,
        floor: 20,
        median: 30,
        lastGame: {
          log: logWithExpected,
          score: fantasyPoints(logWithExpected),
          total: scoredTotal,
          isSpike: false,
        },
        mean: 31.41,
      },
    };

    const rosterCsv = buildRosterCsv([
      { player: reservePlayer },
      {
        player: makePlayer({
          sleeperId: "p-2",
          name: "=CMD()",
          team: "+TST",
          positions: ["PG"],
          rosterStatus: "starter",
        }),
        analysis: fakeAnalytics,
      },
    ]);

    const lines = rosterCsv.split("\r\n");
    expect(lines[0]).toBe("Player,Team,Pos,Status,Ceiling,Median,Floor,Last Game,GP");
    expect(rosterCsv).toContain('"Doe, ""Ace""\r\n=SUM(A1)"');
    expect(rosterCsv).toContain('"NY\nK"');
    expect(rosterCsv).toContain("Reserve");
    expect(rosterCsv).toContain("=CMD(),+TST,PG,Starter,40.00,30.00,20.00");
    expect(rosterCsv).not.toContain("31.41");
    expect(rosterCsv).not.toContain("999.99");
    expect(rosterCsv.toLowerCase()).not.toContain("expectedtotal");

    const logsCsv = buildPlayerLogsCsv(reservePlayer, [logWithExpected]);
    expect(logsCsv).toContain('"BOS\rMIL"');
    expect(logsCsv).toContain('"espn,""quote""\r\nline"');
    expect(logsCsv).toContain(scoredTotal.toFixed(2));
    expect(logsCsv).not.toContain("999.99");
  });

  // T5-F2
  it("T5-F2: formatLockAdvisorSummary & formatMatchupSummary cover all status/sign branches and omit mean/expectedTotal", () => {
    const week = makeWeek({ leg: 4, opponentName: "Timberwolves" });
    const baseEval: LockDecisionEvaluation = {
      sleeperId: "p-1",
      status: "DECISION",
      recommendation: "LEAN_RIDE",
      bankedScore: 30,
      bankedGameDate: "2026-11-02",
      bankedOpponent: "BOS",
      lock: null,
      latestLegGame: null,
      lockGainVsLatest: 0,
      remainingGameDates: ["2026-11-06"],
      remainingGamesCount: 1,
      gamesPlayed: 4,
      ceiling: 45,
      floor: 15,
      beatCount: 2,
      nonBeatCount: 2,
      beatRate: 0.5,
      pAnyBeat: 0.5,
      meanUpside: 10,
      meanShortfall: 5,
      rideEV: -2.5,
      nearCeiling: false,
      maxGainToCeiling: 15,
    };

    const rows: StarterAdvisorRow[] = [
      {
        slotIndex: 0,
        slot: "PG",
        player: makePlayer({ sleeperId: "p-1", name: "Lean Rider" }),
        evaluation: { ...baseEval, recommendation: "LEAN_RIDE", rideEV: -2.5 },
      },
      {
        slotIndex: 1,
        slot: "SG",
        player: makePlayer({ sleeperId: "p-2", name: "Null Rec" }),
        evaluation: { ...baseEval, sleeperId: "p-2", recommendation: null, rideEV: 0 },
      },
      {
        slotIndex: 2,
        slot: "G",
        player: makePlayer({ sleeperId: "p-3", name: "No Games" }),
        evaluation: {
          ...baseEval,
          sleeperId: "p-3",
          status: "NO_GAMES_LEFT",
          recommendation: null,
          remainingGamesCount: 0,
        },
      },
      {
        slotIndex: 3,
        slot: "SF",
        player: makePlayer({ sleeperId: "p-4", name: "No Banked" }),
        evaluation: {
          ...baseEval,
          sleeperId: "p-4",
          status: "NO_BANKED_SCORE",
          recommendation: null,
          bankedScore: null,
        },
      },
    ];

    const negMatchup: MatchupEvaluation = {
      leg: 4,
      userTotal: 200,
      opponentTotal: 212.5,
      margin: -12.5,
      userBestCase: 260,
      userWorstCase: 200,
      totalStarterRemainingGames: 3,
      unlockedStarterRemainingGames: 2,
      startersWithRemainingGames: 2,
      unlockedStartersWithRemainingGames: 1,
      starterBounds: [],
    };

    const advisorNeg = formatLockAdvisorSummary(week, rows, negMatchup);
    expect(advisorNeg).toContain("(-12.50)");
    expect(advisorNeg).toContain("LEAN RIDE");
    expect(advisorNeg).toContain("EV -2.50");
    expect(advisorNeg).toContain("| — |");
    expect(advisorNeg).toContain("EV 0.00");
    expect(advisorNeg).toContain("| FINAL |");
    expect(advisorNeg).toContain("| NO BANKED |");
    expect(advisorNeg.toLowerCase()).not.toContain("mean");
    expect(advisorNeg.toLowerCase()).not.toContain("expectedtotal");

    const tiedMatchup: MatchupEvaluation = { ...negMatchup, opponentTotal: 200, margin: 0 };
    const advisorTied = formatLockAdvisorSummary(week, rows, tiedMatchup);
    expect(advisorTied).toContain("(+0.00)");

    const matchupNegText = formatMatchupSummary(week, negMatchup, []);
    expect(matchupNegText).toContain("(-12.50)");
    expect(matchupNegText).toContain("Bench Swings: None");

    const matchupTiedText = formatMatchupSummary(week, tiedMatchup, []);
    expect(matchupTiedText).toContain("(+0.00)");
    expect(matchupTiedText.toLowerCase()).not.toContain("mean");
    expect(matchupTiedText.toLowerCase()).not.toContain("expectedtotal");
  });

  // T5-F3
  it("T5-F3: downloadCsv guards missing URL.createObjectURL and missing URL.revokeObjectURL without throwing", () => {
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    try {
      Object.defineProperty(URL, "createObjectURL", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(() => downloadCsv("test.csv", "a,b\r\n1,2")).not.toThrow();

      const createMock = vi.fn().mockReturnValue("blob:mock-url");
      Object.defineProperty(URL, "createObjectURL", {
        value: createMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        value: undefined,
        configurable: true,
        writable: true,
      });
      expect(() => downloadCsv("test.csv", "a,b\r\n1,2")).not.toThrow();
      expect(createMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        value: origCreate,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        value: origRevoke,
        configurable: true,
        writable: true,
      });
    }
  });

  // T5-F4
  it("T5-F4: BoxPlot handles negative scores, min===max===0 with bankedScore=0, iqr===0 with right-edge bankedScore, and NaN bankedScore", () => {
    const makeScoredGames = (totals: number[]) =>
      totals.map((total, idx) => ({
        log: makeLog({ date: `2026-11-0${idx + 1}` }),
        score: fantasyPoints(makeLog({ date: `2026-11-0${idx + 1}` })),
        total,
        isSpike: false,
      }));

    // 1. Negative scores
    const negTotals = [-10, -5, -2];
    const negSummary = fiveNumberSummary(negTotals)!;
    const r1 = render(<BoxPlot games={makeScoredGames(negTotals)} summary={negSummary} />);
    expect(screen.getByTestId("boxplot-tick-min").textContent).toBe("-10.00");
    expect(screen.getByTestId("boxplot-tick-max").textContent).toBe("-2.00");
    expect(screen.getByTestId("boxplot-svg").innerHTML).not.toContain("NaN");
    r1.unmount();

    // 2. min === max === 0 with bankedScore === 0
    const zeroTotals = [0, 0, 0];
    const zeroSummary = fiveNumberSummary(zeroTotals)!;
    const r2 = render(
      <BoxPlot games={makeScoredGames(zeroTotals)} summary={zeroSummary} bankedScore={0} />,
    );
    expect(screen.getByTestId("boxplot-banked-marker").textContent).toContain("Banked (0.00)");
    expect(screen.getByTestId("boxplot-svg").innerHTML).not.toContain("NaN");
    r2.unmount();

    // 3. iqr === 0 with right-edge bankedScore === 50 (label x <= 576)
    const flatMidTotals = [10, 30, 30, 30, 50];
    const flatMidSummary = fiveNumberSummary(flatMidTotals)!;
    expect(flatMidSummary.iqr).toBe(0);
    const r3 = render(
      <BoxPlot games={makeScoredGames(flatMidTotals)} summary={flatMidSummary} bankedScore={50} />,
    );
    const boxRect = screen.getByTestId("boxplot-box");
    expect(Number(boxRect.getAttribute("width"))).toBeGreaterThanOrEqual(1);
    const bankedMarker = screen.getByTestId("boxplot-banked-marker");
    const labelText = bankedMarker.querySelector("text");
    expect(labelText).not.toBeNull();
    expect(Number(labelText!.getAttribute("x"))).toBeLessThanOrEqual(576);
    r3.unmount();

    // 4. NaN bankedScore never renders "NaN"
    const r4 = render(
      <BoxPlot
        games={makeScoredGames(flatMidTotals)}
        summary={flatMidSummary}
        bankedScore={Number.NaN}
      />,
    );
    expect(screen.queryByTestId("boxplot-banked-marker")).toBeNull();
    expect(screen.queryByTestId("boxplot-banked-out-note")).toBeNull();
    expect(r4.container.textContent).not.toContain("NaN");
    expect(screen.getByTestId("boxplot-svg").innerHTML).not.toContain("NaN");
  });

  // T5-F5
  it("T5-F5: RosterView multi-position PG/SG, equal-ceiling alphabetical tie-breaker + 0-game starter last, and Export CSV on 0 filtered rows", async () => {
    const playersFile: PlayersFile = {
      asOf: "2026-11-05",
      leagueId: LEAGUE_ID,
      players: [
        makePlayer({ sleeperId: "s-zack", name: "Zack Guard", positions: ["PG", "SG"], rosterStatus: "starter" }),
        makePlayer({ sleeperId: "s-alice", name: "Alice Guard", positions: ["SG"], rosterStatus: "starter" }),
        makePlayer({ sleeperId: "s-aaron", name: "Aaron Zero", positions: ["PG"], rosterStatus: "starter" }),
      ],
    };
    const logs: GameLog[] = [
      makeLog({ sleeperId: "s-zack", date: "2026-11-02", pts: 20, reb: 4, ast: 4, stl: 1, blk: 0, tov: 1 }),
      makeLog({ sleeperId: "s-alice", date: "2026-11-02", pts: 20, reb: 4, ast: 4, stl: 1, blk: 0, tov: 1 }),
    ];

    let capturedBlob: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob) => {
      capturedBlob = b;
      return "blob:roster-empty";
    }) as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;

    render(<RosterView playersFile={playersFile} logs={logs} onSelect={vi.fn()} />);

    // Equal-ceiling alphabetical tie-breaker + 0-game starter last
    const rows = screen.getAllByTestId(/^player-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "player-row-s-alice",
      "player-row-s-zack",
      "player-row-s-aaron",
    ]);

    // Multi-position ["PG", "SG"] appears under both PG and SG
    fireEvent.click(screen.getByTestId("roster-pos-PG"));
    expect(screen.getByTestId("player-row-s-zack")).toBeTruthy();
    expect(screen.queryByTestId("player-row-s-alice")).toBeNull();

    fireEvent.click(screen.getByTestId("roster-pos-SG"));
    expect(screen.getByTestId("player-row-s-zack")).toBeTruthy();
    expect(screen.getByTestId("player-row-s-alice")).toBeTruthy();

    // Export CSV on 0 filtered rows
    fireEvent.change(screen.getByTestId("roster-search-input"), {
      target: { value: "zzzz-no-match" },
    });
    expect(screen.getByTestId("roster-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("export-roster-csv"));
    expect(capturedBlob).not.toBeNull();
    const csvText = await capturedBlob!.text();
    expect(csvText).toBe("Player,Team,Pos,Status,Ceiling,Median,Floor,Last Game,GP");
  });

  // T5-F6
  describe("T5-F6: Clipboard rejection and missing navigator.clipboard keep Copy Summary unchanged", () => {
    let origClipboard: PropertyDescriptor | undefined;

    beforeEach(() => {
      origClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    });

    afterEach(() => {
      if (origClipboard) {
        Object.defineProperty(navigator, "clipboard", origClipboard);
      }
    });

    it("handles rejected writeText and undefined clipboard across LockAdvisorView, MatchupView, and PlayerDetail", async () => {
      const players = createFixturePlayersFile().players;
      const logs = createFixtureGameLogs();
      const locks = createFixtureLocksFile().locks;
      const week = createFixtureWeeksFile().weeks[0]!;
      const fetchLiveStub = vi.fn().mockRejectedValue(new Error("offline"));

      for (const mode of ["reject", "missing"] as const) {
        if (mode === "reject") {
          Object.defineProperty(navigator, "clipboard", {
            value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard denied")) },
            configurable: true,
          });
        } else {
          Object.defineProperty(navigator, "clipboard", {
            value: undefined,
            configurable: true,
          });
        }

        // LockAdvisorView
        const r1 = render(
          <LockAdvisorView
            week={week}
            players={players}
            logs={logs}
            locks={locks}
            onSelectPlayer={vi.fn()}
          />,
        );
        const btn1 = screen.getByTestId("copy-advisor-summary");
        fireEvent.click(btn1);
        await new Promise((r) => setTimeout(r, 10));
        expect(btn1.textContent).toBe("Copy Summary");
        r1.unmount();

        // MatchupView
        const r2 = render(
          <MatchupView
            week={week}
            players={players}
            logs={logs}
            locks={locks}
            fetchLive={fetchLiveStub}
          />,
        );
        const btn2 = screen.getByTestId("copy-matchup-summary");
        fireEvent.click(btn2);
        await new Promise((r) => setTimeout(r, 10));
        expect(btn2.textContent).toBe("Copy Summary");
        r2.unmount();

        // PlayerDetail
        const r3 = render(
          <PlayerDetail player={players[0]!} logs={logs} onBack={vi.fn()} />,
        );
        const btn3 = screen.getByTestId("copy-player-summary");
        fireEvent.click(btn3);
        await new Promise((r) => setTimeout(r, 10));
        expect(btn3.textContent).toBe("Copy Summary");
        r3.unmount();
      }
    });
  });

  // T5-F7
  it("T5-F7: MatchupView ignores stale fetchLive race, reverts cleared override to baseline, and formats margin === 0", async () => {
    const players = createFixturePlayersFile().players;
    const logs = createFixtureGameLogs();
    const locks = createFixtureLocksFile().locks;
    const week1 = createFixtureWeeksFile().weeks[0]!;
    const week2: WeekRecord = { ...week1, leg: 4, opponentPoints: 180 };

    let resolveFirst!: (val: LiveMatchup) => void;
    let resolveSecond!: (val: LiveMatchup) => void;
    const p1 = new Promise<LiveMatchup>((res) => {
      resolveFirst = res;
    });
    const p2 = new Promise<LiveMatchup>((res) => {
      resolveSecond = res;
    });

    const fetchLive = vi
      .fn()
      .mockReturnValueOnce(p1)
      .mockReturnValueOnce(p2);

    const { rerender } = render(
      <MatchupView
        week={week1}
        players={players}
        logs={logs}
        locks={locks}
        fetchLive={fetchLive}
      />,
    );

    // Trigger a newer in-flight fetch before p1 resolves
    rerender(
      <MatchupView
        week={week2}
        players={players}
        logs={logs}
        locks={locks}
        fetchLive={fetchLive}
      />,
    );

    // Faster second request resolves first
    resolveSecond({
      leg: 4,
      matchupId: 1,
      fetchedAt: "2026-11-05T12:01:00Z",
      userPoints: 200,
      opponentRosterId: 2,
      opponentPoints: 222.25,
      opponentStarters: [],
      userStarters: [],
    });

    await waitFor(() => {
      expect(screen.getByTestId("opponent-total").textContent).toBe("222.25");
    });

    // Slower first request resolves later — must NOT overwrite 222.25
    resolveFirst({
      leg: 3,
      matchupId: 1,
      fetchedAt: "2026-11-05T12:00:00Z",
      userPoints: 190,
      opponentRosterId: 2,
      opponentPoints: 111.11,
      opponentStarters: [],
      userStarters: [],
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId("opponent-total").textContent).toBe("222.25");

    // Override opponent total, then clear input to revert to baseline (222.25)
    const input = screen.getByLabelText(/Opponent score override/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "500" } });
    expect(screen.getByTestId("opponent-total").textContent).toBe("500.00");

    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByTestId("opponent-total").textContent).toBe("222.25");

    // Set opponent total equal to userTotal => margin === 0 ("+0.00" and "Tied")
    const userTotal = screen.getByTestId("user-total").textContent!;
    fireEvent.change(input, { target: { value: userTotal } });
    expect(screen.getByTestId("matchup-margin").textContent).toBe("+0.00");
    expect(screen.getByText("Tied")).toBeTruthy();
  });

  // T5-F8
  it("T5-F8: App handles rapid hashchange sequence ending in #player/%20 and empty weeks.json on #advisor/#matchup", async () => {
    window.location.hash = "#roster";
    vi.stubGlobal("fetch", createUiFetchStub());

    const r1 = render(<App />);
    await waitFor(() => {
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });

    for (const nextHash of ["#advisor", "#player/s-c-1", "#matchup", "#player/%20"]) {
      window.location.hash = nextHash;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }

    await waitFor(() => {
      expect(window.location.hash).toBe("#roster");
      expect(screen.getByText("Beltline Ballers")).toBeTruthy();
    });
    r1.unmount();

    // Empty weeks.json renders "No week data loaded." on #advisor and #matchup
    vi.stubGlobal(
      "fetch",
      createUiFetchStub({
        weeks: { leagueId: LEAGUE_ID, weeks: [] },
      }),
    );
    window.location.hash = "#advisor";
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("No week data loaded.")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Matchup" }));
    expect(window.location.hash).toBe("#matchup");
    expect(screen.getByText("No week data loaded.")).toBeTruthy();
  });

  // T5-F9
  it("T5-F9: PlayerDetail handles cleared target input, ff > 0, and ceiling <= 0 (.game-bar width 0%)", () => {
    const player = makePlayer({ sleeperId: "p-neg", name: "Foul Trouble" });
    // pts=0, reb=0, ast=0, stl=0, blk=0, tov=1 (-1), ff=1 (-2) => total = -3.00 (ceiling <= 0)
    const log = makeLog({
      sleeperId: "p-neg",
      date: "2026-11-04",
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 1,
      ff: 1,
    });

    const { container } = render(
      <PlayerDetail player={player} logs={[log]} onBack={vi.fn()} />,
    );

    const gameBar = container.querySelector(".game-bar") as HTMLElement | null;
    expect(gameBar).not.toBeNull();
    expect(gameBar!.style.width).toBe("0%");

    const gameLine = container.querySelector(".game-line")!;
    expect(gameLine.textContent).toContain("· 1 ff");

    const targetInput = screen.getByLabelText("Target score");
    fireEvent.change(targetInput, { target: { value: "" } });
    expect(screen.getByText("Enter a target score to see the beat-rate.")).toBeTruthy();
    expect(screen.queryByTestId("target-evaluation")).toBeNull();
  });
});
