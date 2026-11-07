import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PriorityBadge, RequestStatusBadge } from "@/components/requests/badges";
import { labelize } from "@/lib/format";
import type { DashboardSummary } from "@/lib/dashboard";

export function HiresWaiting({ data }: { data: DashboardSummary["newHiresWithOpenItRequests"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2}>
          New hires waiting on IT <span className="text-muted-foreground">({data.count})</span>
        </CardTitle>
        <CardDescription>People who are still onboarding and have an unresolved request with IT Operations.</CardDescription>
      </CardHeader>
      <CardContent>
      {data.hires.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No new hire is waiting on IT. 🎉</p>
      ) : (
        <ul className="divide-y">
          {data.hires.map((h) => (
            <li key={h.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/onboarding/instances/${h.instanceId}`} className="font-medium underline-offset-4 hover:underline">
                  {h.fullName}
                </Link>
                <span className="text-xs text-muted-foreground">{labelize(h.country)}</span>
              </div>
              <ul className="space-y-1.5">
                {h.openRequests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <Link href={`/requests/${r.id}`} className="underline-offset-4 hover:underline">
                      <span className="text-muted-foreground">{r.reference}</span> {r.title}
                    </Link>
                    <RequestStatusBadge status={r.status} />
                    <PriorityBadge priority={r.priority} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      </CardContent>
    </Card>
  );
}
