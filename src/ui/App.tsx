// App shell: loads roster data at runtime, switches between the Roster
// view and a Player Detail view (client-side, no router). Data is fetched
// from data/*.json (see src/ui/loadData.ts); while loading, a loading
// state is shown, and a fetch failure is shown as an error, never as
// invented numbers.

import { useEffect, useState } from "react";
import { fetchRosterData, type RosterData } from "./loadData.js";
import { PlayerDetail } from "./PlayerDetail.js";
import { RosterView, type RosterSort } from "./RosterView.js";

type View = { name: "roster" } | { name: "detail"; sleeperId: string };

export function App() {
  const [data, setData] = useState<RosterData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ name: "roster" });
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

  if (view.name === "detail") {
    const player = data.players.players.find((p) => p.sleeperId === view.sleeperId);
    if (player === undefined) {
      return (
        <div className="app-shell">
          <button type="button" className="back-button" onClick={() => setView({ name: "roster" })}>
            ← Roster
          </button>
          <p>Player not found.</p>
        </div>
      );
    }
    return (
      <div className="app-shell">
        <header className="app-title">
          <h1>Netrics</h1>
        </header>
        <PlayerDetail
          key={player.sleeperId}
          player={player}
          logs={data.logs}
          onBack={() => setView({ name: "roster" })}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-title">
        <h1>Netrics</h1>
      </header>
      <RosterView
        playersFile={data.players}
        logs={data.logs}
        sort={rosterSort}
        onSortChange={setRosterSort}
        onSelect={(sleeperId) => setView({ name: "detail", sleeperId })}
      />
    </div>
  );
}
