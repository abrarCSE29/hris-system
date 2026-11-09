"use client";

import { useState } from "react";
import { SelectField } from "@/components/select-field";
import { Button } from "@/components/ui/button";
import { useAssignTask, useTaskTransition } from "@/lib/hooks/onboarding";
import { useAssignable } from "@/lib/hooks/users";
import type { OnboardingTask, TaskAction } from "@/lib/types";

/**
 * Start / Complete, and Assign / Reassign for the department head and HR. Shown only for actions the server says
 * this person may take; the server re-checks everything.
 */
export function TaskActions({ task }: { task: Pick<OnboardingTask, "id" | "allowedActions" | "ownerDepartment" | "assignee" | "status"> }) {
  const transition = useTaskTransition();
  const assign = useAssignTask();
  const [choosing, setChoosing] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const actions = task.allowedActions;
  const canAssign = actions.includes("assign");
  const assignable = useAssignable(task.ownerDepartment?.id ?? "", canAssign && choosing && Boolean(task.ownerDepartment));
  if (actions.length === 0) return null;
  const run = (action: TaskAction) => transition.mutate({ taskId: task.id, action });

  return (
    <div className="space-y-2 sm:flex sm:flex-col sm:items-end">
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
        {canAssign && (
          <Button size="sm" variant="outline" aria-expanded={choosing} onClick={() => setChoosing((v) => !v)}>
            {task.assignee ? "Reassign" : "Assign"}
          </Button>
        )}
      </div>
      {canAssign && choosing && (
        <form
          className="flex w-full flex-col gap-2 sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            assign.mutate({ taskId: task.id, assigneeId }, { onSuccess: () => { setChoosing(false); setAssigneeId(""); } });
          }}
        >
          <SelectField
            id={`assignee-${task.id}`}
            aria-label="Assign to"
            required
            value={assigneeId}
            onValueChange={setAssigneeId}
            placeholder={assignable.isPending ? "Loading…" : "Choose a person…"}
            options={(assignable.data?.data ?? []).filter((u) => u.id !== task.assignee?.id).map((u) => ({ value: u.id, label: `${u.fullName} · ${u.jobTitle}` }))}
          />
          <Button type="submit" size="sm" className="self-end" disabled={!assigneeId || assign.isPending}>
            {assign.isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      )}
    </div>
  );
}
