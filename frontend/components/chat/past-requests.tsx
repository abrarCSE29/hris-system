"use client";

import Link from "next/link";
import { ChatBubble } from "@/components/chat/bubble";
import { PriorityBadge, RequestStatusBadge } from "@/components/requests/badges";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import type { RequestSummary } from "@/lib/types";

interface Props {
  /** As the API returns them: newest first. */
  requests: RequestSummary[] | undefined;
  loading: boolean;
  failed: boolean;
  onNavigate: () => void;
}

/** The person's earlier requests made through the assistant, as pairs of bubbles, oldest first so the newest is nearest the message box. */
export function PastRequests({ requests, loading, failed, onNavigate }: Props) {
  if (loading && !requests) {
    return (
      <div aria-label="Loading your earlier requests" className="space-y-2">
        <div className="flex justify-end">
          <Skeleton className="h-8 w-40 rounded-xl" />
        </div>
        <Skeleton className="h-16 w-56 rounded-xl" />
      </div>
    );
  }
  if (failed && !requests) {
    return <p className="text-center text-xs text-muted-foreground">Couldn&apos;t load your earlier requests.</p>;
  }
  if (!requests || requests.length === 0) return null;

  return (
    <section aria-label="Your earlier requests" className="space-y-4">
      <p className="text-center text-xs text-muted-foreground">Your earlier requests</p>
      {[...requests].reverse().map((r) => (
        <div key={r.id} className="space-y-1.5">
          <ChatBubble from="you">{r.title}</ChatBubble>
          <ChatBubble from="assistant" className="space-y-1.5">
            <div>
              <Link href={`/requests/${r.id}`} onClick={onNavigate} className="font-medium underline underline-offset-4">
                {r.reference}
              </Link>{" "}
              was sent to {r.handlingDepartment.name}.
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <RequestStatusBadge status={r.status} />
              <PriorityBadge priority={r.priority} />
              <time dateTime={r.createdAt} className="text-xs text-muted-foreground">
                {formatDateTime(r.createdAt)}
              </time>
            </div>
          </ChatBubble>
        </div>
      ))}
    </section>
  );
}
