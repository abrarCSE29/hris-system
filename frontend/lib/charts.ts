import type { ApexOptions } from "apexcharts";

/** One series on a bar chart. Colours may be CSS variables ("var(--chart-2)"); they are resolved before drawing. */
export interface BarSeries {
  key: string;
  label: string;
  color: string;
  /** Text colour for the value printed on this series' bars (used when stacked). */
  labelColor: string;
}

export interface ThemeColors {
  foreground: string;
  mutedForeground: string;
  border: string;
}

/** Used until the real theme values are read (server render, first paint) and if a variable is missing. Same values as globals.css. */
export const FALLBACK_COLORS: ThemeColors = { foreground: "#000000", mutedForeground: "#6b6b6b", border: "#eae8e8" };

/**
 * ApexCharts draws SVG with colour *attributes*, which cannot contain `var(--x)`. So theme colours are resolved to
 * real values at runtime from the page's CSS, which keeps the charts in step with the theme instead of copying hex codes.
 */
export function resolveColor(value: string, root: Element | undefined, fallback = "#000000"): string {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value;
  const resolved = root ? getComputedStyle(root).getPropertyValue(m[1]).trim() : "";
  return resolved || m[2]?.trim() || fallback;
}

export function readThemeColors(root: Element | undefined): ThemeColors {
  return {
    foreground: resolveColor("var(--foreground)", root, FALLBACK_COLORS.foreground),
    mutedForeground: resolveColor("var(--muted-foreground)", root, FALLBACK_COLORS.mutedForeground),
    border: resolveColor("var(--border)", root, FALLBACK_COLORS.border),
  };
}

interface BarOptionsInput {
  categories: string[];
  /** Series with colours already resolved to real values. */
  series: { label: string; color: string; labelColor: string }[];
  stacked: boolean;
  animate: boolean;
  theme: ThemeColors;
}

/**
 * Options for a column chart: numbers printed on the bars (zeros hidden), whole-number axis, no toolbar,
 * a legend only when there is more than one series, and growth animation unless `animate` is false.
 */
export function barChartOptions({ categories, series, stacked, animate, theme }: BarOptionsInput): ApexOptions {
  const fontSize = "12px";
  return {
    chart: {
      type: "bar",
      stacked,
      toolbar: { show: false },
      zoom: { enabled: false },
      selection: { enabled: false },
      fontFamily: "inherit",
      foreColor: theme.mutedForeground,
      background: "transparent",
      parentHeightOffset: 0,
      // Off on purpose. Apex's keyboard support makes the whole drawing focusable, so a click on a chart showed a focus ring
      // around it. The chart is hidden from assistive technology (a table next to it carries the same numbers), so it
      // should have no focus stop and no announcements of its own.
      accessibility: { enabled: false },
      animations: {
        enabled: animate,
        speed: 900,
        easing: "easeout",
        animateGradually: { enabled: animate, delay: 150 },
        dynamicAnimation: { enabled: animate, speed: 400 },
      },
    },
    colors: series.map((s) => s.color),
    plotOptions: {
      bar: {
        columnWidth: "45%",
        borderRadius: 4,
        borderRadiusApplication: "end",
        borderRadiusWhenStacked: "last",
        dataLabels: { position: stacked ? "center" : "top" },
      },
    },
    dataLabels: {
      enabled: true,
      offsetY: stacked ? 0 : -22,
      formatter: (value) => (value === 0 ? "" : String(value)),
      style: { fontSize, fontWeight: 400, colors: stacked ? series.map((s) => s.labelColor) : [theme.foreground] },
    },
    stroke: { show: false },
    // Top padding leaves room for the value printed above the tallest bar, which otherwise sits on the chart edge.
    grid: { borderColor: theme.border, strokeDashArray: 0, padding: { top: stacked ? 0 : 24 }, xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
    xaxis: {
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize }, trim: false, rotate: 0 },
      tooltip: { enabled: false },
    },
    yaxis: { min: 0, forceNiceScale: true, labels: { style: { fontSize }, formatter: (value) => String(Math.round(value)) } },
    legend: { show: series.length > 1, position: "bottom", fontSize, markers: { size: 6 }, labels: { colors: theme.foreground } },
    tooltip: { shared: true, intersect: false, theme: "light", style: { fontSize } },
    // No darkening on hover/click: the bars are already black.
    states: { hover: { filter: { type: "none" } }, active: { filter: { type: "none" } } },
  };
}
