import { Badge } from "@/components/ui/badge";
import type { StatusRef, UserStatus } from "@/lib/types";

// Stock variants only; red (default) is reserved for the state that needs attention.
const VARIANT: Record<UserStatus, "default" | "secondary" | "outline"> = {
  ACTIVE: "outline",
  ON_PROBATION: "secondary",
  ON_NOTICE: "default",
};

export function StatusBadge({ status }: { status: StatusRef }) {
  return <Badge variant={VARIANT[status.code as UserStatus] ?? "outline"}>{status.name}</Badge>;
}
