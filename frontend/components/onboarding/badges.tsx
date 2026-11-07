import { Check, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DISPLAY_STATUS_LABEL } from "@/lib/onboarding";
import type { DisplayStatus } from "@/lib/types";

// Stock variants only. Blocked and Completed also carry an icon, so they never depend on colour alone.
const VARIANT: Record<DisplayStatus, "secondary" | "outline" | "ghost"> = {
  NOT_STARTED: "outline",
  IN_PROGRESS: "secondary",
  COMPLETED: "ghost",
  BLOCKED: "outline",
};

export function TaskStatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <Badge variant={VARIANT[status]}>
      {status === "COMPLETED" && <Check aria-hidden />}
      {status === "BLOCKED" && <Lock aria-hidden />}
      {DISPLAY_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Overdue is a flag next to the status, not a status of its own. It uses the default (red) variant. */
export function OverdueBadge() {
  return <Badge>Overdue</Badge>;
}
