"use client";

import { BarCard } from "@/components/dashboard/bar-card";
import { CompletionByCountry } from "@/components/dashboard/completion";
import { HiresWaiting } from "@/components/dashboard/hires-waiting";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { categoryChartData, openRequests, totalPeople } from "@/lib/dashboard";
import { formatDate, labelize } from "@/lib/format";
import { useDashboard } from "@/lib/hooks/dashboard";

export default function DashboardPage() {
  const q = useDashboard();

  if (q.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </div>
    );
  }

  if (q.isError || !q.data) {
    const forbidden = q.error instanceof ApiClientError && q.error.status === 403;
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {forbidden ? (
              "The dashboard is only available to HR Admins."
            ) : (
              <>
                Couldn&apos;t load the dashboard.{" "}
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

  const s = q.data;
  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Company overview as of {formatDate(s.asOf)}.
        </p>
      </header>

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="People" value={totalPeople(s)} hint="across 4 countries" />
        <KpiCard label="Open requests" value={openRequests(s)} hint="not yet resolved" />
        <KpiCard label="Active onboardings" value={s.onboarding.activeHires} hint="new hires in progress" />
        <KpiCard label="Overdue tasks" value={s.onboarding.overdueTasks} hint="onboarding, past due" alert />
        <KpiCard label="Blocked tasks" value={s.onboarding.blockedTasks} hint="waiting on another task" />
      </section>

      <section aria-label="Charts" className="grid gap-4 lg:grid-cols-2">
        <BarCard
          title="Headcount by country"
          description="Everyone on the books today."
          data={s.headcountByCountry.map((c) => ({ name: c.country.name, count: c.count }))}
          series={[{ key: "count", label: "People", color: "var(--chart-2)", labelColor: "var(--background)" }]}
        />
        <BarCard
          title="Requests by status"
          description="Where every service request currently stands."
          data={s.requestsByStatus.map((r) => ({ name: labelize(r.status, { title: false }), count: r.count }))}
          series={[{ key: "count", label: "Requests", color: "var(--chart-2)", labelColor: "var(--background)" }]}
        />
        <div className="lg:col-span-2">
          <BarCard
            title="Requests by category"
            description="Open requests (still need work) and finished ones (resolved or closed), per category."
            data={categoryChartData(s)}
            stacked
            series={[
              { key: "open", label: "Open", color: "var(--chart-2)", labelColor: "var(--background)" },
              { key: "finished", label: "Resolved or closed", color: "var(--chart-5)", labelColor: "var(--foreground)" },
            ]}
          />
        </div>
      </section>

      <section aria-label="Requests and onboarding together" className="grid gap-4 lg:grid-cols-2">
        <HiresWaiting waiting={s.newHiresWaiting} />
        <CompletionByCountry rows={s.completionRateByCountry} />
      </section>
    </div>
  );
}
