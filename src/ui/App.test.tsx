// @vitest-environment jsdom
// App-level test: the real App component with the real seed data files,
// fetch stubbed to serve the on-disk data/*.json. Proves the fetch wiring
// and the roster -> detail navigation end to end (in jsdom).

import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

afterEach(() => cleanup());

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const file = url.endsWith("players.json") ? "data/players.json" : "data/game-logs.json";
      return new Response(readFileSync(file, "utf-8"), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});

describe("App with real seed data", () => {
  it("loads the roster (15 players) and opens a player detail on tap", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());
    expect(screen.getByText("Walker Kessler")).toBeTruthy();
    expect(screen.getByText("Domantas Sabonis")).toBeTruthy();
    expect(screen.getByText("Roster snapshot as of 2026-11-07")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "median" } });
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("median");

    fireEvent.click(screen.getByText("Walker Kessler"));
    await waitFor(() => expect(screen.getByText("Target Score Explorer")).toBeTruthy());
    // Kessler's last game is Nov 6 vs POR at 38.00 (10 games in the seed).
    expect(screen.getByText("GP")).toBeTruthy();
    const cards = screen.getByTestId("summary-cards").textContent ?? "";
    expect(cards).toContain("62.50"); // ceiling
    expect(cards).toContain("10"); // GP
    expect(cards).toContain("Mean (ref only)");

    fireEvent.click(screen.getByText("← Roster"));
    await waitFor(() => expect(screen.getByText("Beltline Ballers")).toBeTruthy());
    expect((screen.getByLabelText("Sort by") as HTMLSelectElement).value).toBe("median");
  });

  it("shows an error, never invented numbers, when data fails to load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Could not load roster data");
  });
});
