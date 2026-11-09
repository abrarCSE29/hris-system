// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { barChartOptions, FALLBACK_COLORS, readThemeColors, resolveColor } from "@/lib/charts";

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

const THEME = { foreground: "#000000", mutedForeground: "#6b6b6b", border: "#eae8e8" };
const ONE = [{ label: "People", color: "#000000", labelColor: "#ffffff" }];
const TWO = [
  { label: "Open", color: "#000000", labelColor: "#ffffff" },
  { label: "Resolved or closed", color: "#cecece", labelColor: "#000000" },
];
const build = (over: Partial<Parameters<typeof barChartOptions>[0]> = {}) =>
  barChartOptions({ categories: ["A", "B"], series: ONE, stacked: false, animate: true, theme: THEME, ...over });

describe("resolveColor", () => {
  it("returns real colours unchanged", () => {
    expect(resolveColor("#ed1c3e", undefined)).toBe("#ed1c3e");
    expect(resolveColor("rgb(1, 2, 3)", undefined)).toBe("rgb(1, 2, 3)");
  });

  it("reads a CSS variable from the page, so charts follow the theme", () => {
    document.documentElement.style.setProperty("--chart-2", "#123456");
    expect(resolveColor("var(--chart-2)", document.documentElement)).toBe("#123456");
  });

  it("falls back when the variable is missing or there is no page to read", () => {
    expect(resolveColor("var(--nope)", document.documentElement, "#abcdef")).toBe("#abcdef");
    expect(resolveColor("var(--chart-2)", undefined, "#abcdef")).toBe("#abcdef");
  });

  it("honours a fallback written inside var()", () => {
    expect(resolveColor("var(--nope, #00ff00)", document.documentElement)).toBe("#00ff00");
  });
});

describe("readThemeColors", () => {
  it("reads foreground, muted text and border from the page", () => {
    document.documentElement.style.setProperty("--foreground", "#111111");
    document.documentElement.style.setProperty("--muted-foreground", "#222222");
    document.documentElement.style.setProperty("--border", "#333333");
    expect(readThemeColors(document.documentElement)).toEqual({ foreground: "#111111", mutedForeground: "#222222", border: "#333333" });
  });

  it("uses the built-in defaults when nothing is set", () => {
    expect(readThemeColors(document.documentElement)).toEqual(FALLBACK_COLORS);
  });
});

describe("barChartOptions", () => {
  it("is a plain column chart with the categories and series colours", () => {
    const o = build({ series: TWO });
    expect(o.chart).toMatchObject({ type: "bar", stacked: false });
    expect(o.xaxis?.categories).toEqual(["A", "B"]);
    expect(o.colors).toEqual(["#000000", "#cecece"]);
  });

  it("switches off Apex's own keyboard focus and announcements (the chart is hidden from assistive technology)", () => {
    expect(build().chart?.accessibility?.enabled).toBe(false);
  });

  it("has no toolbar, zoom or selection to click on", () => {
    const o = build();
    expect(o.chart?.toolbar?.show).toBe(false);
    expect(o.chart?.zoom?.enabled).toBe(false);
    expect(o.chart?.selection?.enabled).toBe(false);
  });

  it("animates the bars growing, and turns animation fully off on request", () => {
    expect(build({ animate: true }).chart?.animations).toMatchObject({ enabled: true, speed: 900, animateGradually: { enabled: true } });
    const off = build({ animate: false }).chart?.animations;
    expect(off?.enabled).toBe(false);
    expect(off?.animateGradually?.enabled).toBe(false);
    expect(off?.dynamicAnimation?.enabled).toBe(false);
  });

  it("puts the number above single bars, in the text colour", () => {
    const o = build();
    expect(o.plotOptions?.bar?.dataLabels?.position).toBe("top");
    expect(o.dataLabels?.style?.colors).toEqual(["#000000"]);
  });

  it("puts the numbers inside stacked bars, each in its own contrasting colour", () => {
    const o = build({ stacked: true, series: TWO });
    expect(o.chart?.stacked).toBe(true);
    expect(o.plotOptions?.bar?.dataLabels?.position).toBe("center");
    expect(o.dataLabels?.style?.colors).toEqual(["#ffffff", "#000000"]);
  });

  it("hides zero labels and prints other numbers as they are", () => {
    const f = build().dataLabels?.formatter as (v: number) => string;
    expect(f(0)).toBe("");
    expect(f(42)).toBe("42");
  });

  it("shows whole numbers on the value axis, starting at zero", () => {
    const y = build().yaxis as { min: number; labels: { formatter: (v: number) => string } };
    expect(y.min).toBe(0);
    expect(y.labels.formatter(7.4)).toBe("7");
    expect(y.labels.formatter(15)).toBe("15");
  });

  it("shows a legend only when there is more than one series", () => {
    expect(build({ series: ONE }).legend?.show).toBe(false);
    expect(build({ series: TWO }).legend?.show).toBe(true);
  });

  it("does not darken bars on hover or click", () => {
    const o = build();
    expect(o.states?.hover?.filter?.type).toBe("none");
    expect(o.states?.active?.filter?.type).toBe("none");
  });

  it("leaves room above the plot for the label on the tallest column, but not when stacked", () => {
    expect(build().grid?.padding?.top).toBeGreaterThanOrEqual(20);
    expect(build({ stacked: true }).grid?.padding?.top).toBe(0);
  });

  it("uses the theme's colours for grid and axis text", () => {
    const o = build({ theme: { foreground: "#101010", mutedForeground: "#202020", border: "#303030" } });
    expect(o.grid?.borderColor).toBe("#303030");
    expect(o.chart?.foreColor).toBe("#202020");
    expect(o.legend?.labels?.colors).toBe("#101010");
  });

  it("inherits the page font so it matches the rest of the app", () => {
    expect(build().chart?.fontFamily).toBe("inherit");
  });
});
