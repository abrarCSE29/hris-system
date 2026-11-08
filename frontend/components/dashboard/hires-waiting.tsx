"use client";

import Link from "next/link";
import { useState } from "react";
import { SelectField } from "@/components/select-field";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PriorityBadge, RequestStatusBadge } from "@/components/requests/badges";
import { labelize } from "@/lib/format";
import type { DashboardSummary } from "@/lib/dashboard";

export function HiresWaiting({ waiting }: { waiting: DashboardSummary["newHiresWaiting"] }) {
  // The department being looked at. Starts on the first entry (IT Operations); if the data refreshes and that
  // department is gone, the first entry is shown instead.
  const [departmentId, setDepartmentId] = useState("");
  const current = waiting.find((w) => w.department.id === departmentId) ?? waiting[0];
  if (!current) return null;
  const { department, hires } = current;

  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xl font-bold">
          New hires waiting on {department.name} <span className="text-muted-foreground">({current.count})</span>
        </CardTitle>
        <CardDescription>People who are still onboarding and have an unresolved request with {department.name}.</CardDescription>
        <CardAction>
          <SelectField
            aria-label="Department"
            value={department.id}
            onValueChange={setDepartmentId}
            options={waiting.map((w) => ({ value: w.department.id, label: w.department.name }))}
            className="w-auto min-w-40"
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* A fixed-height list: when there are more hires than fit, it scrolls inside the card. */}
        <div tabIndex={0} role="region" aria-label={`New hires waiting on ${department.name}`} className="h-80 overflow-y-auto pr-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {hires.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No new hire is waiting on {department.name}. 🎉</p>
          ) : (
            <ul className="divide-y">
              {hires.map((h) => (
                <li key={h.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/onboarding/instances/${h.instanceId}`} className="font-medium underline-offset-4 hover:underline">
                      {h.fullName}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {h.department.name} · {labelize(h.country)}
                    </span>
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
        </div>
      </CardContent>
    </Card>
  );
}
