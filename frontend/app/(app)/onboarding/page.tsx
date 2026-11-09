"use client";

import { Plus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FilterSelect } from "@/components/filter-select";
import { ProgressBar } from "@/components/onboarding/progress";
import { Pagination } from "@/components/pagination";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/hooks/auth";
import { useInstances } from "@/lib/hooks/onboarding";
import { useMeta } from "@/lib/hooks/users";

const PAGE_SIZE = 20;

export default function OnboardingOverviewPage() {
  const me = useMe();
  const meta = useMeta();
  const isHr = me.data?.user.role.code === "HR_ADMIN";
  const [countryId, setCountryId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [countryId, status]);

  const q = useInstances({ countryId, status, page, pageSize: PAGE_SIZE });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            {isHr ? "Progress of every new joiner." : "Progress of your direct reports who are onboarding."}
          </p>
        </div>
        {isHr && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" render={<Link href="/onboarding/assign" />} nativeButton={false}>
              <Plus className="size-4" /> Assign checklist
            </Button>
            <Button render={<Link href="/people/new" />} nativeButton={false}>
              <UserPlus className="size-4" /> Add new hire
            </Button>
          </div>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="All countries"
          value={countryId}
          onChange={setCountryId}
          options={(meta.data?.countries ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect
          label="Active and completed"
          value={status}
          onChange={setStatus}
          options={[
            { value: "ACTIVE", label: "In progress" },
            { value: "COMPLETED", label: "Completed" },
          ]}
        />
      </div>

      {q.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Couldn&apos;t load onboarding progress.</AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableCaption className="sr-only">Onboarding progress</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>New joiner</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden sm:table-cell">Started</TableHead>
                <TableHead className="w-56">Progress</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isPending && Array.from({ length: 6 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-8 w-full" />
                  </TableCell>
                </TableRow>
              ))}
              {q.data?.data.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link href={`/onboarding/instances/${i.id}`} className="font-medium underline-offset-4 hover:underline">
                      {i.employee.fullName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {i.employee.jobTitle} · {i.employee.country.name}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{i.employee.department.name}</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(i.startDate)}</TableCell>
                  <TableCell>
                    <div className="space-y-1.5">
                      <ProgressBar percent={i.progress.percentComplete} label={`${i.employee.fullName} progress`} />
                      <div className="text-xs text-muted-foreground">
                        {i.progress.percentComplete}% · {i.progress.completed}/{i.progress.total} done
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {i.progress.overdue > 0 && <Badge>{i.progress.overdue} overdue</Badge>}
                      {i.progress.blocked > 0 && <Badge variant="outline">{i.progress.blocked} blocked</Badge>}
                      {i.status === "COMPLETED" && <Badge variant="ghost">Completed</Badge>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {q.data && q.data.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-muted-foreground">
                    {status === "COMPLETED" ? "No completed onboardings." : "No one is onboarding right now."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {q.data && <Pagination page={page} pageSize={PAGE_SIZE} total={q.data.total} onPageChange={setPage} />}
    </div>
  );
}
