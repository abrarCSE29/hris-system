"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { barChartOptions, FALLBACK_COLORS, readThemeColors, resolveColor, type BarSeries } from "@/lib/charts";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

// ApexCharts touches `window`, so it is loaded in the browser only.
const Chart = dynamic(() => import("react-apexcharts"), { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> });

export type Series = BarSeries;

interface Props {
  title: string;
  description: string;
  data: ({ name: string } & Record<string, number | string>)[];
  series: BarSeries[];
  stacked?: boolean;
}

/**
 * A bar chart (ApexCharts) in a shadcn Card. The numbers are printed on the bars and a hidden table mirrors them
 * for screen readers, so the data never depends on colour or on seeing the chart; the chart itself is hidden from
 * assistive technology.
 */
export function BarCard({ title, description, data, series, stacked = false }: Props) {
  // Bars grow from the axis when the chart appears or its data changes, unless the user prefers less motion.
  const animate = !useReducedMotion();

  // Theme colours are read from the page's CSS once mounted (see lib/charts.ts for why).
  const [theme, setTheme] = useState(FALLBACK_COLORS);
  const [root, setRoot] = useState<Element>();
  useEffect(() => {
    setRoot(document.documentElement);
    setTheme(readThemeColors(document.documentElement));
  }, []);

  const options = useMemo(
    () =>
      barChartOptions({
        categories: data.map((d) => d.name),
        series: series.map((s) => ({ label: s.label, color: resolveColor(s.color, root), labelColor: resolveColor(s.labelColor, root, "#ffffff") })),
        stacked,
        animate,
        theme,
      }),
    [data, series, stacked, animate, theme, root],
  );
  const apexSeries = useMemo(() => series.map((s) => ({ name: s.label, data: data.map((d) => Number(d[s.key])) })), [data, series]);

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-64 w-full" aria-hidden>
          <Chart type="bar" height="100%" width="100%" series={apexSeries} options={options} />
        </div>

        <table className="sr-only">
          <caption>{title}</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              {series.map((s) => (
                <th key={s.key} scope="col">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                {series.map((s) => (
                  <td key={s.key}>{row[s.key]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
