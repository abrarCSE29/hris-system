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

/**
 * Vertical history in the style of shadcnblocks "Timeline 19" (a single column, dot markers on one continuous line,
 * date above a bold title, muted detail beneath), drawn in our theme: black line and dots, the latest step in red and blinking while the request is still open (steady when closed, or for people who prefer reduced motion).
 * The line is drawn per step, from one dot to the next, so it always meets the dots exactly and stops at the last one.
 */
export function Timeline({ events }: { events: RequestEvent[] }) {
  // Nothing more will happen once a request is closed, so its last dot stops blinking.
  const closed = events.at(-1)?.toStatus === "CLOSED";
  return (
    <ol className="space-y-0" aria-label="History">
      {events.map((e, i) => {
        const latest = i === events.length - 1;
        return (
          <li key={e.id} data-slot="timeline-item" aria-current={latest ? "step" : undefined} className="relative pb-8 pl-8 last:pb-0">
            {!latest && <span aria-hidden data-slot="timeline-line" className="absolute top-4 -bottom-1 left-1.5 w-px -translate-x-1/2 bg-foreground" />}
            <span
              aria-hidden
              data-slot="timeline-dot"
              className={`absolute top-1 left-0 size-3 rounded-full ${latest ? `bg-primary ring-4 ring-primary/20 ${closed ? "" : "animate-pulse motion-reduce:animate-none"}` : "bg-foreground"}`}
            />
            <time dateTime={e.createdAt} className="block text-xs text-muted-foreground">
              {formatDateTime(e.createdAt)}
            </time>
            <div className="text-sm font-semibold">{describe(e)}</div>
            <div className="text-sm text-muted-foreground">by {e.actor.fullName}</div>
            {e.note && <p className="mt-1 text-sm text-muted-foreground">&ldquo;{e.note}&rdquo;</p>}
          </li>
        );
      })}
    </ol>
  );
}
