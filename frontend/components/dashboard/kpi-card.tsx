import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: number;
  hint?: string;
  /** Red is reserved for numbers that mean something is wrong. */
  alert?: boolean;
}

export function KpiCard({ label, value, hint, alert = false }: Props) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="text-xs font-medium uppercase tracking-wide">{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <CardTitle className={cn("text-3xl font-semibold tracking-tight", alert && value > 0 && "text-primary")}>{value}</CardTitle>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
