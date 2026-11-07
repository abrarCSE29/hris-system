import { Badge } from "@/components/ui/badge";
import { labelize } from "@/lib/format";
import type { RequestPriority, RequestStatus } from "@/lib/types";

type Variant = "default" | "secondary" | "outline" | "ghost";

// Stock Badge variants only. In this theme: default = red (needs attention), secondary = black, outline = white with border.
const STATUS: Record<RequestStatus, Variant> = {
  SUBMITTED: "outline",
  ASSIGNED: "outline",
  IN_PROGRESS: "secondary",
  RESOLVED: "ghost",
  CLOSED: "ghost",
};

const PRIORITY: Record<RequestPriority, Variant> = {
  LOW: "ghost",
  MEDIUM: "outline",
  HIGH: "secondary",
  URGENT: "default",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge variant={STATUS[status]}>{labelize(status, { title: false })}</Badge>;
}

export function PriorityBadge({ priority }: { priority: RequestPriority }) {
  return <Badge variant={PRIORITY[priority]}>{labelize(priority, { title: false })}</Badge>;
}
