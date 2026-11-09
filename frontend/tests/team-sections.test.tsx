// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Apex needs real SVG layout that jsdom lacks, so stand in for it and record what the chart is handed.
const seen: { props?: Record<string, any> } = {};
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeChart(props: Record<string, any>) {
      seen.props = props;
      return <div data-testid="apex-chart" />;
    },
}));

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
  seen.props = undefined;
  vi.unstubAllGlobals();
});

const person = (id: string, fullName: string, n: Partial<TeamDashboard["people"][number]> = {}) => ({
  id, fullName, jobTitle: "Engineer", openRequests: 0, openTasks: 0, overdueTasks: 0, resolvedInPeriod: 0, tasksCompletedOnTime: 0, tasksCompletedLate: 0, ...n,
});
const CY = { id: "c-cy", shortcode: "CY", name: "Cyprus" };
const data = (over: Partial<TeamDashboard> = {}): TeamDashboard => ({
  asOf: "2026-06-15", periodDays: 30, periodStart: "2026-05-17", teamSize: 3,
  requests: { open: 5, resolvedInPeriod: 7, avgHoursToResolve: 30 },
  tasks: { open: 6, overdue: 2, blocked: 1, completedOnTime: 4, completedLate: 1 },
  // Name order, deliberately NOT the order of the numbers, so a sort by performance would show.
  people: [
    person("u1", "Ana Perera", { openRequests: 0, openTasks: 0 }),
    person("u2", "Ben Karim", { openRequests: 5, openTasks: 6, overdueTasks: 2, resolvedInPeriod: 7, tasksCompletedOnTime: 4, tasksCompletedLate: 1 }),
    person("u3", "Cy Dunne", { openRequests: 1, openTasks: 1, resolvedInPeriod: 2 }),
  ],
  newHires: [
    { employee: { id: "u1", fullName: "Ana Perera", country: CY }, instanceId: "inst-1", percentComplete: 40, overdue: 2, blocked: 1 },
    { employee: { id: "u3", fullName: "Cy Dunne", country: CY }, instanceId: "inst-3", percentComplete: 0, overdue: 0, blocked: 0 },
  ],
  ...over,
});
const reply = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
function setup(body: TeamDashboard) {
  vi.stubGlobal("fetch", vi.fn(() => reply(body)));
  render(<QueryClientProvider client={new QueryClient()}><TeamPage /></QueryClientProvider>);
}
const table = async () => within(await screen.findByRole("table", { name: "Your team, person by person" }));

describe("per-person table", () => {
  it("has one row per direct report, in the order given (name order), with every count", async () => {
    setup(data());
    const t = await table();
    expect(t.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Name", "Open requests", "Open tasks", "Overdue tasks", "Resolved", "Done on time", "Done late",
    ]);
    const rows = t.getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell").map((c) => c.textContent))).toEqual([
      ["Ana PereraEngineer", "0", "0", "0", "0", "0", "0"],
      ["Ben KarimEngineer", "5", "6", "2", "7", "4", "1"],
      ["Cy DunneEngineer", "1", "1", "0", "2", "0", "0"],
    ]);
  });

  it("shows people with no work as zeros, and says what the period columns cover", async () => {
    setup(data());
    await table();
    expect(screen.getByText(/Resolved and Done cover the last 30 days/)).toBeTruthy();
  });

  it("marks overdue tasks in red only when there are some", async () => {
    setup(data());
    const t = await table();
    const cells = (name: string) => within(t.getByRole("row", { name: new RegExp(name) })).getAllByRole("cell");
    expect(cells("Ben Karim")[3].className).toContain("text-primary");
    expect(cells("Ana Perera")[3].className).not.toContain("text-primary");
  });

  it("has no ranking, ordering controls or verdicts", async () => {
    setup(data());
    await table();
    expect(screen.queryByRole("button", { name: /sort/i })).toBeNull();
    expect(screen.queryByText(/score|rank|best|worst|top performer|underperform/i)).toBeNull();
  });

  it("changes with the period", async () => {
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(() => reply(++call === 1 ? data() : data({ periodDays: 7, periodStart: "2026-06-09", people: [person("u1", "Ana Perera", { resolvedInPeriod: 9 })], teamSize: 1, newHires: [] }))));
    render(<QueryClientProvider client={new QueryClient()}><TeamPage /></QueryClientProvider>);
    await table();
    await userEvent.click(screen.getByRole("combobox", { name: "Period" }));
    await userEvent.click(within(await screen.findByRole("listbox")).getByRole("option", { name: "Last 7 days" }));
    await waitFor(() => expect(screen.getByText(/Resolved and Done cover the last 7 days/)).toBeTruthy());
    expect(within((await table()).getAllByRole("row")[1]).getAllByRole("cell")[4].textContent).toBe("9");
  });
});

describe("workload chart", () => {
  it("shows each person's open requests and open tasks, as stacked bars in the table's order", async () => {
    setup(data());
    expect(await screen.findByTestId("apex-chart")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Workload per person" })).toBeTruthy();
    expect(seen.props?.series).toEqual([
      { name: "Open requests", data: [0, 5, 1] },
      { name: "Open tasks", data: [0, 6, 1] },
    ]);
    expect(seen.props?.options.xaxis.categories).toEqual(["Ana Perera", "Ben Karim", "Cy Dunne"]);
    expect(seen.props?.options.chart.stacked).toBe(true);
  });

  it("uses the same numbers as the table", async () => {
    setup(data());
    const t = await table();
    const rows = t.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell").map((c) => Number(c.textContent!.replace(/\D*$/, "")) || 0));
    expect(seen.props?.series[0].data).toEqual(rows.map((r) => r[1]));
    expect(seen.props?.series[1].data).toEqual(rows.map((r) => r[2]));
  });
});

describe("the team's new hires", () => {
  it("lists each with a link to their checklist, their progress and what is late", async () => {
    setup(data());
    const list = within(await screen.findByRole("list", { name: "New hires" }));
    const items = list.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    const ana = within(items[0]);
    expect(ana.getByRole("link", { name: "Ana Perera" }).getAttribute("href")).toBe("/onboarding/instances/inst-1");
    expect(ana.getByText("Cyprus")).toBeTruthy();
    expect(ana.getByText("40%")).toBeTruthy();
    expect(ana.getByRole("progressbar", { name: /Ana Perera/ }).getAttribute("aria-valuenow")).toBe("40");
    expect(ana.getByText("2 overdue · 1 blocked")).toBeTruthy();
    const cy = within(items[1]);
    expect(cy.getByRole("link", { name: "Cy Dunne" }).getAttribute("href")).toBe("/onboarding/instances/inst-3");
    expect(cy.getByText("On track")).toBeTruthy(); // nothing overdue or blocked
  });

  it("says so when none of the team is onboarding", async () => {
    setup(data({ newHires: [] }));
    expect(await screen.findByText("None of your direct reports is onboarding right now.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "New hires" })).toBeNull();
  });
});

describe("sections for an empty team", () => {
  it("are not shown", async () => {
    setup(data({ teamSize: 0, people: [], newHires: [] }));
    await screen.findByText("You have no direct reports yet.");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId("apex-chart")).toBeNull();
    expect(screen.queryByText("Your new hires")).toBeNull();
  });
});
