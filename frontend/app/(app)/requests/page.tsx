"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FilterSelect } from "@/components/filter-select";
import { Pagination } from "@/components/pagination";
import { PriorityBadge, RequestStatusBadge } from "@/components/requests/badges";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, labelize } from "@/lib/format";
import { useMe } from "@/lib/hooks/auth";
import { useRequests } from "@/lib/hooks/requests";
import { useMeta } from "@/lib/hooks/users";

const PAGE_SIZE = 20;

export default function RequestsPage() {
  const me = useMe();
  const meta = useMeta();
  const isHr = me.data?.user.role.code === "HR_ADMIN";

  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState("");
  const [countryId, setCountryId] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, categoryId, priority, countryId]);

  const requests = useRequests({ status, categoryId, priority, countryId, page, pageSize: PAGE_SIZE });
  const filtered = Boolean(status || categoryId || priority || countryId);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Requests</h1>
          <p className="text-sm text-muted-foreground">
            {isHr ? "Every service request across the company." : "Requests you can see: yours, your team's and the ones assigned to you."}
          </p>
        </div>
        <Button render={<Link href="/requests/new" />} nativeButton={false}>
          <Plus className="size-4" /> New request
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="All statuses"
          value={status}
          onChange={setStatus}
          options={(meta.data?.enums.requestStatuses ?? []).map((s) => ({ value: s, label: labelize(s, { title: false }) }))}
        />
        <FilterSelect
          label="All categories"
          value={categoryId}
          onChange={setCategoryId}
          options={(meta.data?.requestCategories ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <FilterSelect
          label="All priorities"
          value={priority}
          onChange={setPriority}
          options={(meta.data?.enums.requestPriorities ?? []).map((p) => ({ value: p, label: labelize(p, { title: false }) }))}
        />
        {isHr && (
          <FilterSelect
            label="All countries"
            value={countryId}
            onChange={setCountryId}
            options={(meta.data?.countries ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
        )}
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setStatus("");
              setCategoryId("");
              setPriority("");
              setCountryId("");
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {requests.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            Couldn&apos;t load requests.{" "}
            <button className="underline" onClick={() => requests.refetch()}>
              Try again
            </button>
          </AlertDescription>
        </Alert>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableCaption className="sr-only">Service requests</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Request</TableHead>
                <TableHead className="hidden md:table-cell">Category</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden lg:table-cell">Assignee</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.isPending &&
                Array.from({ length: 8 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={6}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {requests.data?.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link href={`/requests/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.title}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {r.reference} · {r.requester.fullName}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{r.category.name}</TableCell>
                  <TableCell>
                    <PriorityBadge priority={r.priority} />
                  </TableCell>
                  <TableCell>
                    <RequestStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">{r.assignee?.fullName ?? <span className="text-muted-foreground">Unassigned</span>}</TableCell>
                  <TableCell className="hidden whitespace-nowrap sm:table-cell">{formatDate(r.createdAt.slice(0, 10))}</TableCell>
                </TableRow>
              ))}
              {requests.data && requests.data.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    {filtered ? "No requests match these filters." : "No requests yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {requests.data && <Pagination page={page} pageSize={PAGE_SIZE} total={requests.data.total} onPageChange={setPage} />}
    </div>
  );
}
