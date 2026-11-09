import { OverdueBadge, TaskStatusBadge } from "@/components/onboarding/badges";
import { TaskActions } from "@/components/onboarding/task-actions";
import { formatDate } from "@/lib/format";
import type { OnboardingTask } from "@/lib/types";
import { Card } from "@/components/ui/card";

export function ownerLabel(t: Pick<OnboardingTask, "ownerType" | "ownerDepartment" | "assignee">): string {
  if (t.ownerType === "DEPARTMENT") return `${t.ownerDepartment?.name ?? "Department"} · ${t.assignee ? t.assignee.fullName : "Not assigned yet"}`;
  return t.assignee ? `Manager · ${t.assignee.fullName}` : "Manager";
}

/** A checklist: every task with its owner, due date, calculated status and any actions the viewer may take. */
export function TaskList({ tasks }: { tasks: OnboardingTask[] }) {
  return (
    <Card className="gap-0 py-0">
    <ol className="divide-y" aria-label="Checklist">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className={t.displayStatus === "COMPLETED" ? "font-medium text-muted-foreground line-through" : "font-medium"}>{t.title}</span>
              <TaskStatusBadge status={t.displayStatus} />
              {t.overdue && <OverdueBadge />}
            </div>
            {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
            <p className="text-xs text-muted-foreground">
              {ownerLabel(t)} · Due {formatDate(t.dueDate)}
              {t.completedBy && ` · Done by ${t.completedBy.fullName}`}
            </p>
            {t.blocked && t.dependsOn && (
              <p className="text-xs text-muted-foreground">Waiting for &ldquo;{t.dependsOn.title}&rdquo;</p>
            )}
          </div>
          <TaskActions task={t} />
        </li>
      ))}
    </ol>
    </Card>
  );
}
