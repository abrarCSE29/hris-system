"use client";

import { ProgressBar, progressSentence } from "@/components/onboarding/progress";
import { TaskList } from "@/components/onboarding/task-list";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useMyOnboarding } from "@/lib/hooks/onboarding";

export default function MyOnboardingPage() {
  const q = useMyOnboarding();

  if (q.isPending) {
    return (
      <div className="max-w-3xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription>Couldn&apos;t load your onboarding checklist.</AlertDescription>
      </Alert>
    );
  }
  if (!q.data) {
    return (
      <div className="max-w-3xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">My onboarding</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have an onboarding checklist.</p>
      </div>
    );
  }

  const c = q.data;
  const done = c.status === "COMPLETED";
  return (
    <div className="max-w-3xl space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">{done ? "Onboarding complete" : "Welcome aboard"}</h1>
        <p className="text-sm text-muted-foreground">
          {c.template.name} · started {formatDate(c.startDate)}
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
