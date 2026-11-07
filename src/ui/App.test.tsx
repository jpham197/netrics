// @vitest-environment jsdom
// App-level test: the real App component with the real seed data files,
// fetch stubbed to serve the on-disk data/*.json. Proves the fetch wiring,
// top-level tab switching (Roster, Lock Advisor, Matchup), and Player Detail
// drill-down with Banked (B) chip end to end (in jsdom).

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

afterEach(() => cleanup());

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("players.json")) {
        const players = JSON.parse(readFileSync("data/players.json", "utf-8"));
        players.asOf = "2026-11-07";
        return new Response(JSON.stringify(players), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("weeks.json")) {
        return new Response(readFileSync("data/weeks.json", "utf-8"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("locks.json")) {
        return new Response(readFileSync("data/locks.json", "utf-8"), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      const logs = JSON.parse(readFileSync("data/game-logs.json", "utf-8")).filter(
        (l: { date: string }) => l.date <= "2026-11-06",
      );
      return new Response(JSON.stringify(logs), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});


describe("App with real seed data", () => {
  it("loads the roster (15 players), switches to Lock Advisor and Matchup tabs, and opens Player Detail with Banked chip", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());
    expect(screen.getByText("Walker Kessler")).toBeTruthy();
    expect(screen.getByText("Domantas Sabonis")).toBeTruthy();
    expect(screen.getByText("Roster snapshot as of 2026-11-07")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "median" } });
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("median");

    // Drill down from Roster into Walker Kessler -> shows Banked (38.00) chip
    fireEvent.click(screen.getByText("Walker Kessler"));
    await waitFor(() => expect(screen.getByText("Target Score Explorer")).toBeTruthy());
    expect(screen.getByText("GP")).toBeTruthy();
    const cards = screen.getByTestId("summary-cards").textContent ?? "";
    expect(cards).toContain("62.50"); // ceiling
    expect(cards).toContain("10"); // GP
    expect(cards).toContain("Mean (ref only)");
    expect(screen.getByTestId("banked-chip").textContent).toBe("Banked (38.00)");

    fireEvent.click(screen.getByText("← Roster"));
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("median");

    // Navigate to Lock Advisor tab and drill down into Lauri Markkanen (locked at 47.50)
    fireEvent.click(screen.getByRole("button", { name: "Lock Advisor" }));
    await waitFor(() => expect(screen.getByText("Lock Advisor — Leg 3")).toBeTruthy());
    fireEvent.click(screen.getByText("Lauri Markkanen"));
    await waitFor(() => expect(screen.getByTestId("banked-chip")).toBeTruthy());
    expect(screen.getByTestId("banked-chip").textContent).toBe("Banked (47.50)");
    fireEvent.click(screen.getByTestId("banked-chip"));
    expect((screen.getByLabelText("Target score") as HTMLInputElement).value).toBe("47.50");

    fireEvent.click(screen.getByText("← Lock Advisor"));
    await waitFor(() => expect(screen.getByText("Lock Advisor — Leg 3")).toBeTruthy());

    // Navigate to Matchup tab
    fireEvent.click(screen.getByRole("button", { name: "Matchup" }));
    await waitFor(() => expect(screen.getByText("Weekly Matchup — Leg 3")).toBeTruthy());
    expect(screen.getByTestId("user-total").textContent).toBe("407.25");
  });

  it("shows an error, never invented numbers, when data fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Could not load roster data");
  });
});
