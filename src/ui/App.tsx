// App shell: loads roster + Phase 3 week/lock data at runtime, provides
// top-level navigation between Roster, Lock Advisor, and Matchup views,
// and drills down into Player Detail from any view (client-side, no router).
// Data is fetched from data/*.json (see src/ui/loadData.ts); while loading,
// a loading state is shown, and a fetch failure is shown as an error, never
// as invented numbers.

import { useEffect, useState } from "react";
import { evaluatePlayerForWeek } from "../advisor/index.js";
import { fetchRosterData, type RosterData } from "./loadData.js";
import { LockAdvisorView } from "./LockAdvisorView.js";
import { MatchupView } from "./MatchupView.js";
import { PlayerDetail } from "./PlayerDetail.js";
import { RosterView, type RosterSort } from "./RosterView.js";

type Tab = "roster" | "advisor" | "matchup";
type View =
  | { name: "tab"; tab: Tab }
  | { name: "detail"; sleeperId: string; returnTab: Tab };

export function App() {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "tab", tab: "roster" });
  const [rosterSort, setRosterSort] = useState<RosterSort>("ceiling");

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
          <h1>Netrics</h1>
        </header>
        <p role="alert" className="error">
          Could not load roster data: {error}
        </p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="app-shell">
        <header className="app-title">
          <h1>Netrics</h1>
        </header>
        <p>Loading roster…</p>
      </div>
    );
  }

  // Active week defaults to the highest leg in weeks.json
  const sortedWeeks = [...data.weeks.weeks].sort((a, b) => b.leg - a.leg);
  const activeWeek = sortedWeeks[0] ?? null;

  const activeTab: Tab = view.name === "tab" ? view.tab : view.returnTab;

  const navHeader = (
    <header className="app-title">
      <div className="app-bar">
        <h1>Netrics</h1>
        <nav className="app-nav" aria-label="Main navigation">
          <button
            type="button"
            className={activeTab === "roster" && view.name === "tab" ? "nav-active" : ""}
            onClick={() => setView({ name: "tab", tab: "roster" })}
          >
            Roster
          </button>
          <button
            type="button"
            className={activeTab === "advisor" && view.name === "tab" ? "nav-active" : ""}
            onClick={() => setView({ name: "tab", tab: "advisor" })}
          >
            Lock Advisor
          </button>
          <button
            type="button"
            className={activeTab === "matchup" && view.name === "tab" ? "nav-active" : ""}
            onClick={() => setView({ name: "tab", tab: "matchup" })}
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
          <button
            type="button"
            className="back-button"
            onClick={() => setView({ name: "tab", tab: view.returnTab })}
          >
            {backLabel}
          </button>
          <p>Player not found.</p>
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
        <PlayerDetail
          key={player.sleeperId}
          player={player}
          logs={data.logs}
          asOf={data.players.asOf}
          bankedScore={bankedScore}
          backLabel={backLabel}
          onBack={() => setView({ name: "tab", tab: view.returnTab })}
        />
      </div>
    );
  }

  if (view.tab === "advisor") {
    return (
      <div className="app-shell">
        {navHeader}
        {activeWeek === null ? (
          <p className="empty-note">No week data loaded.</p>
        ) : (
          <LockAdvisorView
            week={activeWeek}
            players={data.players.players}
            logs={data.logs}
            locks={data.locks.locks}
            onSelectPlayer={(sleeperId) =>
              setView({ name: "detail", sleeperId, returnTab: "advisor" })
            }
          />
        )}
      </div>
    );
  }

  if (view.tab === "matchup") {
    return (
      <div className="app-shell">
        {navHeader}
        {activeWeek === null ? (
          <p className="empty-note">No week data loaded.</p>
        ) : (
          <MatchupView
            week={activeWeek}
            players={data.players.players}
            logs={data.logs}
            locks={data.locks.locks}
            onSelectPlayer={(sleeperId) =>
              setView({ name: "detail", sleeperId, returnTab: "matchup" })
            }
          />
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      {navHeader}
      <RosterView
        playersFile={data.players}
        logs={data.logs}
        sort={rosterSort}
        onSortChange={setRosterSort}
        onSelect={(sleeperId) => setView({ name: "detail", sleeperId, returnTab: "roster" })}
      />
    </div>
  );
}
