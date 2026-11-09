import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressBar } from "@/components/onboarding/progress";
import type { DashboardSummary } from "@/lib/dashboard";

export function CompletionByCountry({ rows }: { rows: DashboardSummary["completionRateByCountry"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xl font-bold">Onboarding completion by country</CardTitle>
        <CardDescription>Share of assigned onboarding tasks that are done, by where the new joiner works.</CardDescription>
      </CardHeader>
      <CardContent>
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.country.id} className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{r.country.name}</div>
                <div className="text-xs text-muted-foreground">
                  {r.hires === 0 ? "No onboardings" : `${r.tasksCompleted}/${r.tasksTotal} tasks · ${r.hires} ${r.hires === 1 ? "hire" : "hires"}`}
                </div>
              </div>
              {r.hires > 0 && <div className="shrink-0 text-3xl font-semibold tracking-tight tabular-nums">{r.completionRate}%</div>}
            </div>
            <ProgressBar animateOnMount percent={r.completionRate} label={`${r.country.name} onboarding completion`} />
          </li>
        ))}
      </ul>
      </CardContent>
    </Card>
  );
}
