// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Apex needs real SVG layout that jsdom lacks (the chart has its own tests), so stand in for it.
vi.mock("next/dynamic", () => ({ default: () => function FakeChart() { return <div data-testid="apex-chart" />; } }));

import TeamPage from "@/app/(app)/team/page";
import type { TeamDashboard } from "@/lib/team";

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const data = (over: Partial<TeamDashboard> = {}): TeamDashboard => ({
  asOf: "2026-06-15",
  periodDays: 30,
  periodStart: "2026-05-17",
  teamSize: 4,
  requests: { open: 7, resolvedInPeriod: 12, avgHoursToResolve: 45 },
  tasks: { open: 9, overdue: 3, blocked: 2, completedOnTime: 11, completedLate: 4 },
  newHires: [],
  people: [],
  ...over,
});
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function setup(handler: (url: string) => Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => (urls.push(url), handler(url))));
  render(<QueryClientProvider client={new QueryClient()}><TeamPage /></QueryClientProvider>);
  return urls;
}
const card = (label: string) => screen.getByText(label, { selector: "div" }).closest("[data-slot='card']") as HTMLElement;

describe("Team dashboard page", () => {
  it("shows the team's numbers as cards, for the last 30 days by default", async () => {
    const urls = setup(() => reply(200, data()));
    expect(await screen.findByRole("heading", { name: "Team dashboard" })).toBeTruthy();
    expect(urls[0]).toBe("/api/v1/dashboard/team?days=30");
    expect(within(card("Open requests")).getByText("7")).toBeTruthy();
    expect(within(card("Resolved")).getByText("12")).toBeTruthy();
    expect(within(card("Time to resolve")).getByText("1 d 21 h")).toBeTruthy();
    expect(within(card("Open tasks")).getByText("9")).toBeTruthy();
    expect(within(card("Overdue tasks")).getByText("3")).toBeTruthy();
    expect(within(card("Blocked tasks")).getByText("2")).toBeTruthy();
    expect(within(card("Done on time")).getByText("11")).toBeTruthy();
    expect(within(card("Done late")).getByText("4")).toBeTruthy();
    expect(screen.getByText(/4 direct reports/)).toBeTruthy();
    expect(screen.getByText(/17 May 2026/)).toBeTruthy(); // the period start, so the manager knows what "30 days" means
  });

  it("shows a dash when nothing was resolved", async () => {
    setup(() => reply(200, data({ requests: { open: 0, resolvedInPeriod: 0, avgHoursToResolve: null } })));
    expect(within(await waitFor(() => card("Time to resolve"))).getByText("—")).toBeTruthy();
  });

  it("changes the period, asks for it, and shows the new numbers", async () => {
    const urls = setup((url) =>
      reply(200, url.endsWith("days=7") ? data({ periodDays: 7, periodStart: "2026-06-09", requests: { open: 7, resolvedInPeriod: 3, avgHoursToResolve: 6 } }) : data()),
    );
    await screen.findByRole("heading", { name: "Team dashboard" });
    const picker = screen.getByRole("combobox", { name: "Period" });
    expect(picker.textContent).toContain("Last 30 days");
    await userEvent.click(picker);
    const list = await screen.findByRole("listbox");
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Last 7 days", "Last 30 days", "Last 90 days"]);
    await userEvent.click(within(list).getByRole("option", { name: "Last 7 days" }));
    await waitFor(() => expect(urls).toContain("/api/v1/dashboard/team?days=7"));
    await waitFor(() => expect(within(card("Resolved")).getByText("3")).toBeTruthy());
    expect(within(card("Time to resolve")).getByText("6 h")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Period" }).textContent).toContain("Last 7 days");
  });

  it("says so when the manager has no direct reports, and shows no cards", async () => {
    setup(() => reply(200, data({ teamSize: 0 })));
    expect(await screen.findByText("You have no direct reports yet.")).toBeTruthy();
    expect(screen.queryByText("Open requests")).toBeNull();
  });

  it("tells a non-manager the page is not for them", async () => {
    setup(() => reply(403, { error: { code: "FORBIDDEN", message: "Forbidden" } }));
    expect(await screen.findByText("The team dashboard is only available to Managers.")).toBeTruthy();
  });

  it("offers a retry when loading fails", async () => {
    let calls = 0;
    setup(() => (++calls === 1 ? reply(500, { error: { code: "INTERNAL", message: "x" } }) : reply(200, data())));
    const retry = await screen.findByRole("button", { name: "Try again" });
    await userEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "Team dashboard" })).toBeTruthy();
    expect(within(card("Open requests")).getByText("7")).toBeTruthy();
  });

  it("shows no ranking, score or per-person verdict", async () => {
    setup(() => reply(200, data()));
    await screen.findByRole("heading", { name: "Team dashboard" });
    expect(screen.queryByText(/score|rank|best|worst|top performer/i)).toBeNull();
  });
});
