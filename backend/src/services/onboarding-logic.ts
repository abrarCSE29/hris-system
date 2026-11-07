import type { OnboardingTaskStatus } from "@/generated/prisma/client";

/**
 * Pure onboarding rules (no database): dates in Asia/Dhaka, deadline labels, dependency validation,
 * and the calculated Blocked / Overdue state (spec §3.3). Blocked and Overdue are never stored.
 */

// ── dates ────────────────────────────────────────────────────────────────────

/** Today's calendar date in Asia/Dhaka as YYYY-MM-DD (the spec's reference timezone for "overdue"). */
export function todayInDhaka(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "2026-11-08" + 3 → "2026-11-11". Pure calendar arithmetic, no timezone involved. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

// ── deadline labels ──────────────────────────────────────────────────────────

/**
 * Offset in days from the start date for the standard labels: Day 1 = 0, Day 30 = 29,
 * Week 1 = 4 (end of the first working week), Week 2 = 9. Returns null for a custom label.
 */
export function offsetForLabel(label: string): number | null {
  const m = /^(day|week)\s+(\d{1,3})$/i.exec(label.trim());
  if (!m) return null;
  const n = Number(m[2]);
  if (n < 1) return null;
  return m[1].toLowerCase() === "day" ? n - 1 : 5 * n - 1;
}

// ── template dependency graph ────────────────────────────────────────────────

export interface GraphNode {
  key: string;
  dependsOnKey?: string | null;
}

export interface GraphProblem {
  index: number;
  field: "key" | "dependsOnKey";
  message: string;
}

/**
 * Checks a template's tasks: unique keys, dependencies that point at another task in the same
 * template, and no cycles. Each task has at most one dependency, so a chain can be followed
 * with a simple walk.
 */
export function findDependencyProblems(tasks: GraphNode[]): GraphProblem[] {
  const problems: GraphProblem[] = [];
  const indexByKey = new Map<string, number>();
  tasks.forEach((t, i) => {
    if (indexByKey.has(t.key)) problems.push({ index: i, field: "key", message: `Duplicate task key "${t.key}"` });
    else indexByKey.set(t.key, i);
  });

  const validNext = new Map<string, string>();
  tasks.forEach((t, i) => {
    if (!t.dependsOnKey) return;
    if (t.dependsOnKey === t.key) {
      problems.push({ index: i, field: "dependsOnKey", message: "A task cannot depend on itself" });
    } else if (!indexByKey.has(t.dependsOnKey)) {
      problems.push({ index: i, field: "dependsOnKey", message: `Unknown task key "${t.dependsOnKey}"` });
    } else {
      validNext.set(t.key, t.dependsOnKey);
    }
  });

  // Walk each chain; revisiting a key within one walk means a cycle.
  const reported = new Set<string>();
  tasks.forEach((t, i) => {
    const seen = new Set<string>([t.key]);
    let cur = validNext.get(t.key);
    while (cur !== undefined) {
      if (seen.has(cur)) {
        if (!reported.has(t.key)) {
          problems.push({ index: i, field: "dependsOnKey", message: "Dependencies form a cycle" });
          // Mark every member of this cycle so it is reported once per task, not once per walk.
          let k: string | undefined = cur;
          do { reported.add(k); k = validNext.get(k); } while (k !== undefined && k !== cur);
          reported.add(t.key);
        }
        return;
      }
      seen.add(cur);
      cur = validNext.get(cur);
    }
  });
  return problems;
}

// ── calculated task status ───────────────────────────────────────────────────

export type DisplayStatus = "COMPLETED" | "BLOCKED" | "IN_PROGRESS" | "NOT_STARTED";

export interface TaskFacts {
  status: OnboardingTaskStatus;
  /** Status of the task this one depends on; null when it has no dependency. */
  dependsOnStatus: OnboardingTaskStatus | null;
  dueDate: string; // YYYY-MM-DD
}

/** blocked = not completed, and the task it depends on is not completed. */
export function isBlocked(t: Pick<TaskFacts, "status" | "dependsOnStatus">): boolean {
  return t.status !== "COMPLETED" && t.dependsOnStatus !== null && t.dependsOnStatus !== "COMPLETED";
}

/** overdue = not completed, and due before today (Asia/Dhaka). A task due today is not overdue. */
export function isOverdue(t: Pick<TaskFacts, "status" | "dueDate">, today: string): boolean {
  return t.status !== "COMPLETED" && t.dueDate < today;
}

/** Shown as: Completed → Blocked → In Progress / Not Started. Overdue is a separate flag. */
export function displayStatus(t: Pick<TaskFacts, "status" | "dependsOnStatus">): DisplayStatus {
  if (t.status === "COMPLETED") return "COMPLETED";
  if (isBlocked(t)) return "BLOCKED";
  return t.status;
}

export interface ProgressSummary {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  blocked: number;
  overdue: number;
  percentComplete: number;
}

/** Counts by displayed status. `overdue` overlaps the others (an overdue task is also, say, blocked). */
export function summarize(tasks: TaskFacts[], today: string): ProgressSummary {
  const out: ProgressSummary = { total: tasks.length, completed: 0, inProgress: 0, notStarted: 0, blocked: 0, overdue: 0, percentComplete: 0 };
  for (const t of tasks) {
    const s = displayStatus(t);
    if (s === "COMPLETED") out.completed++;
    else if (s === "BLOCKED") out.blocked++;
    else if (s === "IN_PROGRESS") out.inProgress++;
    else out.notStarted++;
    if (isOverdue(t, today)) out.overdue++;
  }
  out.percentComplete = out.total === 0 ? 0 : Math.round((out.completed / out.total) * 100);
  return out;
}
