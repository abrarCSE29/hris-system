import { Badge } from "@/components/ui/badge";
import { labelize } from "@/lib/format";
import type { UserStatus } from "@/lib/types";

// Stock variants only; red (default) is reserved for the state that needs attention.
const VARIANT: Record<UserStatus, "default" | "secondary" | "outline"> = {
  ACTIVE: "outline",
  ON_PROBATION: "secondary",
  ON_NOTICE: "default",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANT[status as UserStatus] ?? "outline"}>{labelize(status, { title: false })}</Badge>;
}
