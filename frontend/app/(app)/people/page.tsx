"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { StatusBadge } from "@/components/people/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiClientError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useMe } from "@/lib/hooks/auth";
import { useDebounced } from "@/lib/hooks/use-debounced";
import { useMeta, useUsers } from "@/lib/hooks/users";

const PAGE_SIZE = 20;

// useSearchParams needs a Suspense boundary so the rest of the page can still be prerendered.
export default function PeoplePage() {
  return (
    <Suspense>
      <People />
    </Suspense>
  );
}

function People() {
  const me = useMe();
  const meta = useMeta();
  const isHr = me.data?.user.role.code === "HR_ADMIN";

  const [search, setSearch] = useState("");
  const [countryId, setCountryId] = useState("");
  // The Departments page links here with ?departmentId=…, which starts the department filter.
  const [departmentId, setDepartmentId] = useState(useSearchParams().get("departmentId") ?? "");
  const [statusId, setStatusId] = useState("");
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search.trim());

  // Any filter change goes back to the first page.
  useEffect(() => setPage(1), [debouncedSearch, countryId, departmentId, statusId]);

  const users = useUsers({ search: debouncedSearch, countryId, departmentId, statusId, page, pageSize: PAGE_SIZE });
  const total = users.data?.total ?? 0;
  const filtered = Boolean(debouncedSearch || countryId || departmentId || statusId);

  const forbidden = users.error instanceof ApiClientError && users.error.status === 403;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{isHr ? "People" : "My team"}</h1>
          <p className="text-sm text-muted-foreground">
            {isHr ? "Everyone across all four countries." : "Your direct reports."}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search people"
            placeholder="Search name, email or code"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterSelect
          label="All countries"
          value={countryId}
          onChange={setCountryId}
          options={(meta.data?.countries ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect
          label="All departments"
          value={departmentId}
          onChange={setDepartmentId}
          options={(meta.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
        />
        <FilterSelect
          label="All statuses"
          value={statusId}
          onChange={setStatusId}
          options={(meta.data?.userStatuses ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setCountryId("");
              setDepartmentId("");
              setStatusId("");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {forbidden ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>You don&apos;t have access to this page.</AlertDescription>
        </Alert>
      ) : users.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Couldn&apos;t load people.{" "}
            <button className="underline" onClick={() => users.refetch()}>
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableCaption className="sr-only">People</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Department</TableHead>
                <TableHead className="hidden lg:table-cell">Job title</TableHead>
                <TableHead className="hidden sm:table-cell">Country</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {users.data?.data.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.fullName}</div>
                    <div className="text-xs text-muted-foreground">
                      {u.email} · {u.employeeCode}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{u.department.name}</TableCell>
                  <TableCell className="hidden lg:table-cell">{u.jobTitle}</TableCell>
                  <TableCell className="hidden sm:table-cell">{u.country.name}</TableCell>
                  <TableCell>
                    <StatusBadge status={u.status} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap lg:table-cell">{formatDate(u.joiningDate)}</TableCell>
                </TableRow>
              ))}
              {users.data && users.data.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    {filtered ? "No one matches these filters." : isHr ? "No people yet." : "You have no direct reports."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {users.data && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />}
    </div>
  );
}
