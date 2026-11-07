import { formatDateTime, labelize } from "@/lib/format";
import type { RequestEvent } from "@/lib/types";

function describe(e: RequestEvent): string {
  switch (e.toStatus) {
    case "SUBMITTED":
      return "Submitted";
    case "ASSIGNED":
      return e.fromStatus === "ASSIGNED" ? `Reassigned to ${e.assignee?.fullName ?? "someone"}` : `Assigned to ${e.assignee?.fullName ?? "someone"}`;
    default:
      return labelize(e.toStatus, { title: true });
  }
}

export function Timeline({ events }: { events: RequestEvent[] }) {
  return (
    <ol className="relative space-y-5 border-l pl-6" aria-label="History">
      {events.map((e, i) => (
        <li key={e.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[31px] top-1.5 size-2.5 rounded-full ${i === events.length - 1 ? "bg-primary" : "bg-foreground"}`}
          />
          <div className="text-sm font-medium">{describe(e)}</div>
          <div className="text-xs text-muted-foreground">
            {e.actor.fullName} · {formatDateTime(e.createdAt)}
          </div>
          {e.note && <p className="mt-1 text-sm text-muted-foreground">&ldquo;{e.note}&rdquo;</p>}
        </li>
      ))}
    </ol>
  );
}
