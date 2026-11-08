import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number;
  hint?: string;
  /** Red is reserved for numbers that mean something is wrong. */
  alert?: boolean;
}

/** The words sit on the left and the figure, large, on the right. */
export function KpiCard({ label, value, hint, alert = false }: Props) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="text-sm font-bold tracking-wide text-foreground uppercase">{label}</div>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className={cn("shrink-0 text-4xl font-semibold tracking-tight tabular-nums", alert && value > 0 && "text-primary")}>{value}</div>
      </CardContent>
    </Card>
  );
}
