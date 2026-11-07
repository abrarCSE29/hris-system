"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Comments } from "@/components/requests/comments";
import { RequestActions } from "@/components/requests/actions";
import { PriorityBadge, RequestStatusBadge } from "@/components/requests/badges";
import { Timeline } from "@/components/requests/timeline";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { formatDateTime, labelize } from "@/lib/format";
import { useRequest } from "@/lib/hooks/requests";
import { Card, CardContent } from "@/components/ui/card";

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const query = useRequest(id);
  const r = query.data;

  const back = (
    <Link href="/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Back to requests
    </Link>
  );

  if (query.isPending) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (query.isError || !r) {
    const notFound = query.error instanceof ApiClientError && query.error.status === 404;
    return (
      <div className="space-y-6">
        {back}
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {notFound ? "This request doesn't exist, or you don't have access to it." : "Couldn't load this request."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const details: [string, React.ReactNode][] = [
    ["Requested by", `${r.requester.fullName} · ${labelize(r.requester.country)}`],
    ["Category", r.category.name],
    ["Handled by", r.handlingDepartment.name],
    ["Assignee", r.assignee?.fullName ?? "Unassigned"],
    ["Created", formatDateTime(r.createdAt)],
    ["Last updated", formatDateTime(r.updatedAt)],
  ];

  return (
    <div className="max-w-4xl space-y-8">
      <div className="space-y-4">
        {back}
        <header className="space-y-3">
          <div className="text-sm text-muted-foreground">{r.reference}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{r.title}</h1>
          <div className="flex flex-wrap gap-2">
            <RequestStatusBadge status={r.status} />
            <PriorityBadge priority={r.priority} />
          </div>
        </header>
      </div>

      <RequestActions request={r} />

      <section aria-labelledby="desc-heading" className="space-y-3">
        <h2 id="desc-heading" className="sr-only">
          Details
        </h2>
        <p className="whitespace-pre-wrap">{r.description}</p>
        <Card size="sm">
          <CardContent>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {details.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
              <dd className="mt-0.5">{v}</dd>
            </div>
          ))}
        </dl>
          </CardContent>
        </Card>
      </section>

      <section aria-labelledby="history-heading" className="space-y-4">
        <h2 id="history-heading" className="text-lg font-semibold tracking-tight">
          History
        </h2>
        <Timeline events={r.events} />
      </section>

      <Comments requestId={r.id} comments={r.comments} />
    </div>
  );
}
