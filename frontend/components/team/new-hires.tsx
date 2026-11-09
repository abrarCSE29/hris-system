import Link from "next/link";
import { ProgressBar } from "@/components/onboarding/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamDashboard } from "@/lib/team";
import { cn } from "@/lib/utils";

/** The team's own new hires (direct reports with an active checklist), each linking to their checklist. */
export function NewHires({ hires }: { hires: TeamDashboard["newHires"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xl font-bold">
          Your new hires
        </CardTitle>
        <CardDescription>Direct reports who are working through an onboarding checklist.</CardDescription>
      </CardHeader>
      <CardContent>
        {hires.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">None of your direct reports is onboarding right now.</p>
        ) : (
          <ul aria-label="New hires" className="space-y-4">
            {hires.map((h) => {
              const late = [h.overdue > 0 && `${h.overdue} overdue`, h.blocked > 0 && `${h.blocked} blocked`].filter(Boolean).join(" · ");
              return (
                <li key={h.instanceId} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <Link href={`/onboarding/instances/${h.instanceId}`} className="text-sm font-medium underline-offset-4 hover:underline">
                        {h.employee.fullName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        <span>{h.employee.country.name}</span>
                        {" · "}
                        <span className={cn(h.overdue > 0 && "font-semibold text-primary")}>{late || "On track"}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-3xl font-semibold tracking-tight tabular-nums">{h.percentComplete}%</div>
                  </div>
                  <ProgressBar percent={h.percentComplete} label={`${h.employee.fullName} onboarding progress`} />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
