"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ProgressBar, progressSentence } from "@/components/onboarding/progress";
import { TaskList } from "@/components/onboarding/task-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { formatDate, labelize } from "@/lib/format";
import { useInstance } from "@/lib/hooks/onboarding";

export default function InstancePage() {
  const { id } = useParams<{ id: string }>();
  const q = useInstance(id);
  const back = (
    <Link href="/onboarding" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Back to onboarding
    </Link>
  );

  if (q.isPending) {
    return (
      <div className="max-w-3xl space-y-4">
        {back}
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    const notFound = q.error instanceof ApiClientError && q.error.status === 404;
    return (
      <div className="max-w-3xl space-y-4">
        {back}
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {notFound ? "This checklist doesn't exist, or you don't have access to it." : "Couldn't load this checklist."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const c = q.data;
  return (
    <div className="max-w-3xl space-y-6">
      {back}
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{c.employee.fullName}</h1>
        <p className="text-sm text-muted-foreground">
          {c.employee.jobTitle} · {c.employee.department.name} · {labelize(c.employee.country)}
          <br />
          {c.template.name} · started {formatDate(c.startDate)}
          {c.status === "COMPLETED" && " · completed"}
        </p>
        <div className="space-y-2">
          <ProgressBar percent={c.progress.percentComplete} label="Onboarding progress" />
          <p className="text-sm">
            <span className="font-medium">{c.progress.percentComplete}%</span>
            <span className="text-muted-foreground"> · {progressSentence(c.progress)}</span>
          </p>
        </div>
      </header>
      <TaskList tasks={c.tasks} />
    </div>
  );
}
