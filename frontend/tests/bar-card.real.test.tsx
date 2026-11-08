// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { BarCard } from "@/components/dashboard/bar-card";

/**
 * Renders the REAL ApexCharts (no stub) to prove it accepts our options and draws what we expect.
 * jsdom has no layout, so the few SVG measuring functions Apex calls are given plausible fixed answers.
 */
beforeAll(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never;
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  const box = { x: 0, y: 0, width: 40, height: 14, top: 0, left: 0, right: 40, bottom: 14 };
  Object.assign(SVGElement.prototype, { getBBox: () => box, getComputedTextLength: () => 40, getScreenCTM: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }), createSVGMatrix: () => ({}) });
  for (const p of ["offsetWidth", "clientWidth"]) Object.defineProperty(HTMLElement.prototype, p, { configurable: true, value: 640 });
  for (const p of ["offsetHeight", "clientHeight"]) Object.defineProperty(HTMLElement.prototype, p, { configurable: true, value: 256 });
  HTMLElement.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, width: 640, height: 256, top: 0, left: 0, right: 640, bottom: 256, toJSON() {} });
});
afterEach(cleanup);

const DATA = [{ name: "Bangladesh", count: 42 }, { name: "Malaysia", count: 25 }, { name: "Cyprus", count: 15 }];
const SERIES = [{ key: "count", label: "People", color: "var(--chart-2)", labelColor: "var(--background)" }];

describe("BarCard with the real ApexCharts", () => {
  it("draws one bar per category with the numbers printed on them", async () => {
    const { container } = render(<BarCard title="Headcount" description="d" data={DATA} series={SERIES} />);
    await waitFor(() => expect(container.querySelector(".apexcharts-canvas svg")).toBeTruthy(), { timeout: 5000 });
    await waitFor(() => expect(container.querySelectorAll(".apexcharts-bar-area").length).toBe(3), { timeout: 5000 });
    const labels = [...container.querySelectorAll(".apexcharts-datalabel")].map((n) => n.textContent);
    expect(labels).toEqual(["42", "25", "15"]);
    const axis = [...container.querySelectorAll(".apexcharts-xaxis-label")].map((n) => n.textContent);
    expect(axis).toEqual(["Bangladesh", "Malaysia", "Cyprus"]);
  });

  it("draws no toolbar and nothing keyboard-focusable inside the chart", async () => {
    const { container } = render(<BarCard title="Headcount" description="d" data={DATA} series={SERIES} />);
    await waitFor(() => expect(container.querySelector(".apexcharts-canvas svg")).toBeTruthy(), { timeout: 5000 });
    expect(container.querySelector(".apexcharts-toolbar")?.children.length ?? 0).toBe(0);
    const focusable = [...container.querySelectorAll(".apexcharts-canvas [tabindex]")].filter((el) => el.getAttribute("tabindex") !== "-1");
    expect(focusable.map((el) => el.getAttribute("class"))).toEqual([]);
  });
});
