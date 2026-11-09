import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { TeamDashboard } from "@/lib/team";

/**
 * One row per direct report, in name order. Deliberately no sorting and no highlighting of a "best" or "worst" person:
 * the numbers are for balancing work, not for ranking people. Red marks only overdue tasks.
 */
export function PeopleTable({ people, periodDays }: { people: TeamDashboard["people"]; periodDays: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-xl font-bold">
          Person by person
        </CardTitle>
        <CardDescription>
          Open and Overdue are as of today. Resolved and Done cover the last {periodDays} days. Work assigned to each person.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption className="sr-only">Your team, person by person</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Open requests</TableHead>
              <TableHead className="text-right">Open tasks</TableHead>
              <TableHead className="text-right">Overdue tasks</TableHead>
              <TableHead className="text-right">Resolved</TableHead>
              <TableHead className="text-right">Done on time</TableHead>
              <TableHead className="text-right">Done late</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <div className="font-medium">{p.fullName}</div>
                  <div className="text-xs text-muted-foreground">{p.jobTitle}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.openRequests}</TableCell>
                <TableCell className="text-right tabular-nums">{p.openTasks}</TableCell>
                <TableCell className={cn("text-right tabular-nums", p.overdueTasks > 0 && "font-semibold text-primary")}>{p.overdueTasks}</TableCell>
                <TableCell className="text-right tabular-nums">{p.resolvedInPeriod}</TableCell>
                <TableCell className="text-right tabular-nums">{p.tasksCompletedOnTime}</TableCell>
                <TableCell className="text-right tabular-nums">{p.tasksCompletedLate}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
