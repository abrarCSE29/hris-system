"use client";

import Link from "next/link";
import { ProgressBar } from "@/components/onboarding/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiClientError } from "@/lib/api";
import { roleSentence, sharePercent, statusSentence } from "@/lib/departments";
import { labelize } from "@/lib/format";
import { useDepartmentBreakdown } from "@/lib/hooks/departments";

export default function DepartmentsPage() {
  const q = useDepartmentBreakdown();

  const header = (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">Departments</h1>
      <p className="text-sm text-muted-foreground">How many people each department has, and who they are. Select a department to see its people.</p>
    </div>
  );

  if (q.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    const forbidden = q.error instanceof ApiClientError && q.error.status === 403;
    return (
      <div className="space-y-6">
        {header}
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {forbidden ? (
              "Departments are only available to HR Admins."
            ) : (
              <>
                Couldn&apos;t load departments.{" "}
                <button className="underline" onClick={() => q.refetch()}>
                  Try again
                </button>
              </>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { total, departments } = q.data;
  const countries = departments[0]?.byCountry.map((c) => c.country) ?? [];
  const countryTotal = (country: string) => departments.reduce((n, d) => n + (d.byCountry.find((c) => c.country === country)?.count ?? 0), 0);

  return (
    <div className="space-y-6">
      {header}
      <div className="rounded-md border">
        <Table>
          <TableCaption className="sr-only">Departments and their headcount</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Department</TableHead>
              <TableHead className="text-right">People</TableHead>
              <TableHead className="hidden w-40 sm:table-cell">Share of company</TableHead>
              {countries.map((c) => (
                <TableHead key={c} className="hidden text-right xl:table-cell">
                  {labelize(c)}
                </TableHead>
              ))}
              <TableHead className="hidden md:table-cell">Status</TableHead>
              <TableHead className="hidden lg:table-cell">Roles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {departments.map((d) => {
              const share = sharePercent(d.headcount, total);
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    <Link href={`/people?departmentId=${d.id}`} className="font-medium hover:underline">
                      {d.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">{d.head ? `Head: ${d.head.fullName}` : "No head assigned"}</div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.headcount}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ProgressBar animateOnMount percent={share} label={`${d.name} share of company`} />
                      </div>
                      <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{share}%</span>
                    </div>
                  </TableCell>
                  {d.byCountry.map((c) => (
                    <TableCell key={c.country} className="hidden text-right tabular-nums xl:table-cell">
                      {c.count}
                    </TableCell>
                  ))}
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{statusSentence(d.byStatus)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{roleSentence(d.byRole)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">All departments</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{total}</TableCell>
              <TableCell className="hidden sm:table-cell" />
              {countries.map((c) => (
                <TableCell key={c} className="hidden text-right font-medium tabular-nums xl:table-cell">
                  {countryTotal(c)}
                </TableCell>
              ))}
              <TableCell className="hidden md:table-cell" />
              <TableCell className="hidden lg:table-cell" />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
