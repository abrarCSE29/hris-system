"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

export interface Series {
  key: string;
  label: string;
  /** A CSS colour or token, e.g. "var(--chart-2)". Black / grey / red only. */
  color: string;
  /** Text colour for the value label drawn on the bar. */
  labelColor: string;
}

interface Props {
  title: string;
  description: string;
  data: ({ name: string } & Record<string, number | string>)[];
  series: Series[];
  stacked?: boolean;
}

/**
 * A shadcn Chart (Recharts underneath) in a shadcn Card. The numbers are printed on the bars and a hidden table
 * mirrors them for screen readers, so the data never depends on colour or on seeing the chart.
 */
export function BarCard({ title, description, data, series, stacked = false }: Props) {
  // Bars grow from the axis when the chart appears or its data changes, unless the user prefers less motion.
  const animate = !useReducedMotion();
  const config: ChartConfig = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }]));

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-hidden>
          <BarChart data={data} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            {series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={`var(--color-${s.key})`}
                stackId={stacked ? "total" : undefined}
                radius={stacked ? 0 : [4, 4, 0, 0]}
                maxBarSize={56}
                isAnimationActive={animate}
                animationDuration={900}
                animationEasing="ease-out"
                animationBegin={i * 200}
              >
                <LabelList
                  dataKey={s.key}
                  position={stacked ? "center" : "top"}
                  fontSize={12}
                  fill={stacked ? s.labelColor : "var(--foreground)"}
                  formatter={(v: unknown) => (typeof v === "number" && v === 0 ? "" : (v as number))}
                />
              </Bar>
            ))}
          </BarChart>
        </ChartContainer>

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
