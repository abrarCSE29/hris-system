import { BarCard } from "@/components/dashboard/bar-card";
import type { TeamDashboard } from "@/lib/team";

/** Who holds how much right now: open requests and open onboarding tasks per person, stacked, in the table's order. */
export function WorkloadChart({ people }: { people: TeamDashboard["people"] }) {
  return (
    <BarCard
      title="Workload per person"
      description="Open requests and open onboarding tasks each person holds right now."
      data={people.map((p) => ({ name: p.fullName, requests: p.openRequests, tasks: p.openTasks }))}
      stacked
      series={[
        { key: "requests", label: "Open requests", color: "var(--chart-2)", labelColor: "var(--background)" },
        { key: "tasks", label: "Open tasks", color: "var(--chart-5)", labelColor: "var(--foreground)" },
      ]}
    />
  );
}
