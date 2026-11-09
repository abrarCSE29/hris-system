"use client";

import { KpiCard } from "@/components/dashboard/kpi-card";
import { NewHires } from "@/components/team/new-hires";
import { PeopleTable } from "@/components/team/people-table";
import { WorkloadChart } from "@/components/team/workload-chart";
import { SelectField } from "@/components/select-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useTeamDashboard } from "@/lib/hooks/team";
import { formatDuration, PERIOD_OPTIONS } from "@/lib/team";
import { useState } from "react";

export default function TeamDashboardPage() {
  const [days, setDays] = useState(30);
  const q = useTeamDashboard(days);

  if (q.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24" />)}</div>
      </div>
    );
  }

  if (q.isError || !q.data) {
    const forbidden = q.error instanceof ApiClientError && q.error.status === 403;
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Team dashboard</h1>
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {forbidden ? (
              "The team dashboard is only available to Managers."
            ) : (
              <>
                Couldn&apos;t load the team dashboard.{" "}
                <button className="underline" onClick={() => q.refetch()}>
                  Try again
                </button>
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const d = q.data;
  const period = `in the last ${d.periodDays} days`;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Team dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {d.teamSize === 0
              ? "You have no direct reports yet."
              : `Your ${d.teamSize} direct report${d.teamSize === 1 ? "" : "s"}, as of ${formatDate(d.asOf)}. Period figures cover ${formatDate(d.periodStart)} to today.`}
          </p>
        </div>
        <SelectField
          aria-label="Period"
          value={String(days)}
          onValueChange={(v) => v && setDays(Number(v))}
          options={PERIOD_OPTIONS}
          className="w-auto min-w-40"
        />
      </header>

      {d.teamSize > 0 && (
        <>
          <section aria-label="Requests" className="space-y-3">
            <h2 className="text-lg font-semibold">Requests assigned to your team</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard label="Open requests" value={d.requests.open} hint="assigned or in progress now" />
              <KpiCard label="Resolved" value={d.requests.resolvedInPeriod} hint={period} />
              <KpiCard label="Time to resolve" value={formatDuration(d.requests.avgHoursToResolve)} hint="average, submitted to resolved" />
            </div>
          </section>

          <section aria-label="Onboarding tasks" className="space-y-3">
            <h2 className="text-lg font-semibold">Onboarding tasks assigned to your team</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <KpiCard label="Open tasks" value={d.tasks.open} hint="not finished yet" />
              <KpiCard label="Overdue tasks" value={d.tasks.overdue} hint="past their due date" alert />
              <KpiCard label="Blocked tasks" value={d.tasks.blocked} hint="waiting on another task" />
              <KpiCard label="Done on time" value={d.tasks.completedOnTime} hint={period} />
              <KpiCard label="Done late" value={d.tasks.completedLate} hint={period} />
            </div>
          </section>

          <section aria-label="Your team" className="grid gap-4 lg:grid-cols-2">
            <WorkloadChart people={d.people} />
            <NewHires hires={d.newHires} />
          </section>

          <PeopleTable people={d.people} periodDays={d.periodDays} />
        </>
      )}
    </div>
  );
}
