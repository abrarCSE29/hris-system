"use client";

import { ArrowLeft, Pencil } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { useTemplate } from "@/lib/hooks/onboarding";
import { Card } from "@/components/ui/card";

export default function TemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const q = useTemplate(id);
  const back = (
    <Link href="/onboarding/templates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Back to templates
    </Link>
  );

  if (q.isPending) return <div className="max-w-3xl space-y-4">{back}<Skeleton className="h-64 w-full" /></div>;
  if (q.isError || !q.data) {
    const nf = q.error instanceof ApiClientError && q.error.status === 404;
    return (
      <div className="max-w-3xl space-y-4">
        {back}
        <Alert variant="destructive" role="alert">
          <AlertDescription>{nf ? "Template not found." : "Couldn't load this template."}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const t = q.data;
  const titleOf = new Map(t.tasks.map((k) => [k.id, k.title]));
  return (
    <div className="max-w-3xl space-y-6">
      {back}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t.name}</h1>
          <p className="text-sm text-muted-foreground">{t.description || "No description."}</p>
          <p className="text-xs text-muted-foreground">Created by {t.createdBy.fullName}</p>
        </div>
        <Button variant="outline" render={<Link href={`/onboarding/templates/${t.id}/edit`} />} nativeButton={false}>
          <Pencil className="size-4" /> Edit template
        </Button>
      </header>
      <Card className="gap-0 py-0">
      <ol className="divide-y" aria-label="Template tasks">
        {t.tasks.map((k, i) => (
          <li key={k.id} className="flex gap-4 p-4">
            <span className="w-6 shrink-0 text-sm text-muted-foreground">{i + 1}</span>
            <div className="min-w-0 space-y-1">
              <div className="font-medium">{k.title}</div>
              {k.description && <p className="text-sm text-muted-foreground">{k.description}</p>}
              <p className="text-xs text-muted-foreground">
                {k.ownerType === "DEPARTMENT" ? k.ownerDepartment?.name : "New joiner's manager"} · {k.deadlineLabel}
                {k.dependsOnId && ` · after “${titleOf.get(k.dependsOnId)}”`}
              </p>
            </div>
          </li>
        ))}
      </ol>
      </Card>
    </div>
  );
}
