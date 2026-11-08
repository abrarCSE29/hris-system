// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Apex needs real SVG layout that jsdom lacks, so stand in for it and record what the card hands to it.
const seen: { props?: Record<string, any> } = {};
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeChart(props: Record<string, any>) {
      seen.props = props;
      return <div data-testid="apex-chart" />;
    },
}));

import { BarCard } from "@/components/dashboard/bar-card";

let reducedMotion = false;
beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: reducedMotion && q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
});
beforeEach(() => { seen.props = undefined; reducedMotion = false; });
afterEach(() => { cleanup(); document.documentElement.removeAttribute("style"); });

const DATA = [{ name: "Bangladesh", count: 42 }, { name: "Cyprus", count: 15 }];
const SERIES = [{ key: "count", label: "People", color: "var(--chart-2)", labelColor: "var(--background)" }];
const TWO = [
  { key: "open", label: "Open", color: "var(--chart-2)", labelColor: "var(--background)" },
  { key: "finished", label: "Resolved or closed", color: "var(--chart-5)", labelColor: "var(--foreground)" },
];

describe("BarCard (ApexCharts)", () => {
  it("shows the title and description in a card", () => {
    const { container } = render(<BarCard title="Headcount by country" description="Everyone." data={DATA} series={SERIES} />);
    expect(screen.getByRole("heading", { name: "Headcount by country" })).toBeTruthy();
    expect(screen.getByText("Everyone.")).toBeTruthy();
    expect(container.querySelector('[data-slot="card"]')).toBeTruthy();
  });

  it("gives the chart one series of numbers and the category names", () => {
    render(<BarCard title="t" description="d" data={DATA} series={SERIES} />);
    expect(screen.getByTestId("apex-chart")).toBeTruthy();
    expect(seen.props?.type).toBe("bar");
    expect(seen.props?.series).toEqual([{ name: "People", data: [42, 15] }]);
    expect(seen.props?.options.xaxis.categories).toEqual(["Bangladesh", "Cyprus"]);
  });

  it("stacks several series, in the order given", () => {
    const data = [{ name: "IT", open: 5, finished: 4 }, { name: "HR", open: 0, finished: 7 }];
    render(<BarCard title="t" description="d" data={data} series={TWO} stacked />);
    expect(seen.props?.series).toEqual([{ name: "Open", data: [5, 0] }, { name: "Resolved or closed", data: [4, 7] }]);
    expect(seen.props?.options.chart.stacked).toBe(true);
    expect(seen.props?.options.legend.show).toBe(true);
  });

  it("turns the theme's CSS variables into real colours for the chart", async () => {
    document.documentElement.style.setProperty("--chart-2", "#123456");
    document.documentElement.style.setProperty("--background", "#fefefe");
    render(<BarCard title="t" description="d" data={DATA} series={SERIES} />);
    await waitFor(() => expect(seen.props?.options.colors).toEqual(["#123456"]));
    expect(JSON.stringify(seen.props?.options)).not.toContain("var(--");
  });

  it("animates unless the user prefers reduced motion", () => {
    render(<BarCard title="t" description="d" data={DATA} series={SERIES} />);
    expect(seen.props?.options.chart.animations.enabled).toBe(true);
    cleanup();
    reducedMotion = true;
    render(<BarCard title="t" description="d" data={DATA} series={SERIES} />);
    expect(seen.props?.options.chart.animations.enabled).toBe(false);
  });

  it("keeps the numbers available to screen readers in a table, and hides the drawing from them", () => {
    const { container } = render(<BarCard title="Headcount" description="d" data={DATA} series={SERIES} />);
    const rows = [...container.querySelectorAll("table.sr-only tbody tr")].map((r) => r.textContent);
    expect(rows).toEqual(["Bangladesh42", "Cyprus15"]);
    expect(screen.getByTestId("apex-chart").closest("[aria-hidden='true']")).toBeTruthy();
  });
});
