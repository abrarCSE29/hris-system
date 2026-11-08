"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FilterSelect } from "@/components/filter-select";
import { OverdueBadge, TaskStatusBadge } from "@/components/onboarding/badges";
import { TaskActions } from "@/components/onboarding/task-actions";
import { ownerLabel } from "@/components/onboarding/task-list";
import { Pagination } from "@/components/pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, labelize } from "@/lib/format";
import { useMe } from "@/lib/hooks/auth";
import { useTaskQueue } from "@/lib/hooks/onboarding";
import { DISPLAY_STATUS_LABEL } from "@/lib/onboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PAGE_SIZE = 20;
const STATUS_OPTIONS = (["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "COMPLETED"] as const).map((s) => ({ value: s, label: DISPLAY_STATUS_LABEL[s] }));

export default function TaskQueuePage() {
  const me = useMe();
  const isHr = me.data?.user.role === "HR_ADMIN";
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, overdue]);

  const q = useTaskQueue({ status, overdue, page, pageSize: PAGE_SIZE });
  const filtered = Boolean(status || overdue);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Task queue</h1>
        <p className="text-sm text-muted-foreground">
          {isHr ? "Onboarding tasks across all new hires. You can act only on the ones your own team owns." : "Onboarding tasks that belong to your team, or to you as a manager."} Open tasks are shown unless you pick a status.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect label="Open tasks" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        <FilterSelect
          label="Any due date"
          value={overdue}
          onChange={setOverdue}
          options={[
            { value: "true", label: "Overdue only" },
            { value: "false", label: "Not overdue" },
          ]}
        />
      </div>

      {q.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Couldn&apos;t load tasks.{" "}
            <button className="underline" onClick={() => q.refetch()}>
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="gap-0 py-0">
        <ul className="divide-y" aria-label="Tasks">
          {q.isPending && Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="p-4">
              <Skeleton className="h-10 w-full" />
            </li>
          ))}
          {q.data?.data.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.title}</span>
                  <TaskStatusBadge status={t.displayStatus} />
                  {t.overdue && <OverdueBadge />}
                </div>
                <p className="text-sm">
                  For{" "}
                  {isHr || me.data?.user.role === "MANAGER" ? (
                    <Link href={`/onboarding/instances/${t.instanceId}`} className="underline underline-offset-4">
                      {t.employee.fullName}
                    </Link>
                  ) : (
                    t.employee.fullName
                  )}{" "}
                  <span className="text-muted-foreground">· {labelize(t.employee.country)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {ownerLabel(t)} · Due {formatDate(t.dueDate)}
                </p>
                {t.blocked && t.dependsOn && <p className="text-xs text-muted-foreground">Waiting for &ldquo;{t.dependsOn.title}&rdquo;</p>}
              </div>
              <TaskActions taskId={t.id} actions={t.allowedActions} />
            </li>
          ))}
          {q.data && q.data.data.length === 0 && (
            <li className="px-4 py-12 text-center text-muted-foreground">
              {filtered ? "No tasks match these filters." : "Nothing to do right now."}
            </li>
          )}
        </ul>
        </Card>
      )}

      {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPageChange={setPage} />}
    </div>
  );
}
