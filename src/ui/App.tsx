// App shell: loads roster + Phase 3 week/lock data at runtime, provides
// top-level navigation between Roster, Lock Advisor, and Matchup views,
// and drills down into Player Detail from any view (client-side, no router).
// Data is fetched from data/*.json (see src/ui/loadData.ts); while loading,
// a loading state is shown, and a fetch failure is shown as an error, never
// as invented numbers.

import { useEffect, useState } from "react";
import { evaluatePlayerForWeek } from "../advisor/index.js";
import { fetchRosterData, type RosterData } from "./loadData.js";
import { LockAdvisorView, type AdvisorFilter } from "./LockAdvisorView.js";
import { MatchupView } from "./MatchupView.js";
import { PlayerDetail } from "./PlayerDetail.js";
import {
  RosterView,
  type PosFilter,
  type RosterSort,
  type StatusFilter,
} from "./RosterView.js";

type Tab = "roster" | "advisor" | "matchup";
type View =
  | { name: "tab"; tab: Tab }
  | { name: "detail"; sleeperId: string; returnTab: Tab };

function parseHash(hash: string): { view: View; isValid: boolean } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (raw === "" || raw === "roster") {
    return { view: { name: "tab", tab: "roster" }, isValid: true };
  }
  if (raw === "advisor") {
    return { view: { name: "tab", tab: "advisor" }, isValid: true };
  }
  if (raw === "matchup") {
    return { view: { name: "tab", tab: "matchup" }, isValid: true };
  }
  if (raw.startsWith("player/")) {
    try {
      const sleeperId = decodeURIComponent(raw.slice("player/".length)).trim();
      if (sleeperId !== "") {
        return { view: { name: "detail", sleeperId, returnTab: "roster" }, isValid: true };
      }
    } catch {
      return { view: { name: "tab", tab: "roster" }, isValid: false };
    }
  }
  return { view: { name: "tab", tab: "roster" }, isValid: false };
}

function viewToHash(view: View): string {
  if (view.name === "detail") {
    return `#player/${encodeURIComponent(view.sleeperId)}`;
  }
  if (view.tab === "advisor") return "#advisor";
  if (view.tab === "matchup") return "#matchup";
  return "#roster";
}

function replaceHash(hash: string): void {
  if (typeof window === "undefined") return;
  try {
    if (typeof window.history?.replaceState === "function") {
      window.history.replaceState(null, "", hash);
      return;
    }
  } catch {
    // Fallback below if replaceState is restricted
  }
  window.location.hash = hash;
}

export function App() {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>(() =>
    parseHash(typeof window !== "undefined" ? window.location.hash : "").view,
  );

  // Lifted filter/sort/override state so navigating View -> Player Detail -> Back preserves state.
  const [rosterSort, setRosterSort] = useState<RosterSort>("ceiling");
  const [rosterSearch, setRosterSearch] = useState<string>("");
  const [rosterPosFilter, setRosterPosFilter] = useState<PosFilter>("All");
  const [rosterStatusFilter, setRosterStatusFilter] = useState<StatusFilter>("All");
  const [advisorFilter, setAdvisorFilter] = useState<AdvisorFilter>("all");
  const [matchupLeg, setMatchupLeg] = useState<number | null>(null);
  const [matchupHasOverride, setMatchupHasOverride] = useState<boolean>(false);
  const [matchupOpponentInput, setMatchupOpponentInput] = useState<string>("");
  const [matchupHideLockedSwaps, setMatchupHideLockedSwaps] = useState<boolean>(false);

  const navigate = (next: View) => {
    setView(next);
    if (typeof window !== "undefined") {
      const nextHash = viewToHash(next);
      if (window.location.hash !== nextHash) {
        window.location.hash = nextHash;
      }
      window.scrollTo?.(0, 0);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const initialParsed = parseHash(window.location.hash);
    if (!initialParsed.isValid) {
      replaceHash("#roster");
      setView({ name: "tab", tab: "roster" });
    }
    const onHashChange = () => {
      const parsed = parseHash(window.location.hash);
      if (!parsed.isValid) {
        replaceHash("#roster");
        setView({ name: "tab", tab: "roster" });
        return;
      }
      setView((prev) => {
        if (
          parsed.view.name === "detail" &&
          prev.name === "detail" &&
          parsed.view.sleeperId === prev.sleeperId
        ) {
          return prev;
        }
        return parsed.view;
      });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchRosterData()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load data");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <div className="app-shell">
        <header className="app-title">
          <div className="brand-title">Netrics</div>
        </header>
        <main>
          <h1>Data Load Error</h1>
          <p role="alert" className="error">
            Could not load roster data: {error}
          </p>
        </main>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="app-shell">
        <header className="app-title">
          <div className="brand-title">Netrics</div>
        </header>
        <main>
          <h1>Loading roster…</h1>
        </main>
      </div>
    );
  }

  // Active week defaults to the highest leg in weeks.json
  const sortedWeeks = [...data.weeks.weeks].sort((a, b) => b.leg - a.leg);
  const activeWeek = sortedWeeks[0] ?? null;

  if (activeWeek !== null && matchupLeg !== activeWeek.leg) {
    setMatchupLeg(activeWeek.leg);
    setMatchupHasOverride(false);
    setMatchupOpponentInput(activeWeek.opponentPoints.toFixed(2));
    setMatchupHideLockedSwaps(false);
  }

  const activeTab: Tab = view.name === "tab" ? view.tab : view.returnTab;

  const navHeader = (
    <header className="app-title">
      <div className="app-bar">
        <div className="brand-title">Netrics</div>
        <nav className="app-nav" aria-label="Main navigation">
          <button
            type="button"
            className={activeTab === "roster" && view.name === "tab" ? "nav-active" : ""}
            aria-current={activeTab === "roster" && view.name === "tab" ? "page" : undefined}
            onClick={() => navigate({ name: "tab", tab: "roster" })}
          >
            Roster
          </button>
          <button
            type="button"
            className={activeTab === "advisor" && view.name === "tab" ? "nav-active" : ""}
            aria-current={activeTab === "advisor" && view.name === "tab" ? "page" : undefined}
            onClick={() => navigate({ name: "tab", tab: "advisor" })}
          >
            Lock Advisor
          </button>
          <button
            type="button"
            className={activeTab === "matchup" && view.name === "tab" ? "nav-active" : ""}
            aria-current={activeTab === "matchup" && view.name === "tab" ? "page" : undefined}
            onClick={() => navigate({ name: "tab", tab: "matchup" })}
          >
            Matchup
          </button>
        </nav>
      </div>
    </header>
  );

  if (view.name === "detail") {
    const player = data.players.players.find((p) => p.sleeperId === view.sleeperId);
    const backLabel =
      view.returnTab === "advisor"
        ? "← Lock Advisor"
        : view.returnTab === "matchup"
          ? "← Matchup"
          : "← Roster";

    if (player === undefined) {
      return (
        <div className="app-shell">
          {navHeader}
          <main>
            <button
              type="button"
              className="back-button"
              onClick={() => navigate({ name: "tab", tab: view.returnTab })}
            >
              {backLabel}
            </button>
            <h1>Player not found.</h1>
          </main>
        </div>
      );
    }

    const bankedScore =
      activeWeek !== null
        ? evaluatePlayerForWeek(player.sleeperId, activeWeek, data.logs, data.locks.locks)
            .bankedScore
        : null;

    return (
      <div className="app-shell">
        {navHeader}
        <main>
          <PlayerDetail
            key={player.sleeperId}
            player={player}
            logs={data.logs}
            asOf={data.players.asOf}
            bankedScore={bankedScore}
            backLabel={backLabel}
            onBack={() => navigate({ name: "tab", tab: view.returnTab })}
          />
        </main>
      </div>
    );
  }

  if (view.tab === "advisor") {
    return (
      <div className="app-shell">
        {navHeader}
        <main>
          {activeWeek === null ? (
            <p className="empty-note">No week data loaded.</p>
          ) : (
            <LockAdvisorView
              week={activeWeek}
              players={data.players.players}
              logs={data.logs}
              locks={data.locks.locks}
              filter={advisorFilter}
              onFilterChange={setAdvisorFilter}
              onSelectPlayer={(sleeperId) =>
                navigate({ name: "detail", sleeperId, returnTab: "advisor" })
              }
            />
          )}
        </main>
      </div>
    );
  }

  if (view.tab === "matchup") {
    return (
      <div className="app-shell">
        {navHeader}
        <main>
          {activeWeek === null ? (
            <p className="empty-note">No week data loaded.</p>
          ) : (
            <MatchupView
              week={activeWeek}
              players={data.players.players}
              logs={data.logs}
              locks={data.locks.locks}
              hasCustomOverride={matchupHasOverride}
              onHasCustomOverrideChange={setMatchupHasOverride}
              opponentInput={matchupOpponentInput}
              onOpponentInputChange={setMatchupOpponentInput}
              hideLockedSwaps={matchupHideLockedSwaps}
              onHideLockedSwapsChange={setMatchupHideLockedSwaps}
              onSelectPlayer={(sleeperId) =>
                navigate({ name: "detail", sleeperId, returnTab: "matchup" })
              }
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {navHeader}
      <main>
        <RosterView
          playersFile={data.players}
          logs={data.logs}
          sort={rosterSort}
          onSortChange={setRosterSort}
          searchQuery={rosterSearch}
          onSearchChange={setRosterSearch}
          posFilter={rosterPosFilter}
          onPosFilterChange={setRosterPosFilter}
          statusFilter={rosterStatusFilter}
          onStatusFilterChange={setRosterStatusFilter}
          onSelect={(sleeperId) => navigate({ name: "detail", sleeperId, returnTab: "roster" })}
        />
      </main>
    </div>
  );
}
