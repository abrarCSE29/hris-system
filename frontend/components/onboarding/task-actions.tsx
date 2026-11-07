"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiClientError } from "@/lib/api";
import { useTaskTransition } from "@/lib/hooks/onboarding";
import type { TaskAction } from "@/lib/types";

/** Start / Complete buttons. Shown only for actions the server says this person may take. */
export function TaskActions({ taskId, actions }: { taskId: string; actions: TaskAction[] }) {
  const transition = useTaskTransition();
  if (actions.length === 0) return null;
  const error = transition.error instanceof ApiClientError ? transition.error.message : transition.error ? "Something went wrong." : null;
  const run = (action: TaskAction) => transition.mutate({ taskId, action });

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        {actions.includes("start") && (
          <Button size="sm" variant="outline" disabled={transition.isPending} onClick={() => run("start")}>
            Start
          </Button>
        )}
        {actions.includes("complete") && (
          <Button size="sm" disabled={transition.isPending} onClick={() => run("complete")}>
            {transition.isPending ? "Saving…" : "Complete"}
          </Button>
        )}
      </div>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
