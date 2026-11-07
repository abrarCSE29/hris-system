import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/onboarding/progress";
import { labelize } from "@/lib/format";
import type { DashboardSummary } from "@/lib/dashboard";

export function CompletionByCountry({ rows }: { rows: DashboardSummary["completionRateByCountry"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>Onboarding completion by country</CardTitle>
        <CardDescription>Share of assigned onboarding tasks that are done, by where the new joiner works.</CardDescription>
      </CardHeader>
      <CardContent>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.country} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{labelize(r.country)}</span>
              <span className="text-muted-foreground">
                {r.hires === 0 ? "No onboardings" : `${r.completionRate}% · ${r.tasksCompleted}/${r.tasksTotal} tasks · ${r.hires} ${r.hires === 1 ? "hire" : "hires"}`}
              </span>
            </div>
            <ProgressBar animateOnMount percent={r.completionRate} label={`${labelize(r.country)} onboarding completion`} />
          </li>
        ))}
      </ul>
      </CardContent>
    </Card>
  );
}
