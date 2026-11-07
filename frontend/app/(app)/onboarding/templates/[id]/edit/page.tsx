"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { TemplateForm } from "@/components/onboarding/template-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { useTemplate, useUpdateTemplate } from "@/lib/hooks/onboarding";

export default function EditTemplatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const q = useTemplate(id);
  const update = useUpdateTemplate(id);
  const back = (
    <Link href={`/onboarding/templates/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="size-4" /> Back to template
    </Link>
  );

  if (q.isPending) return <div className="max-w-3xl space-y-4">{back}<Skeleton className="h-96 w-full" /></div>;
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

  return (
    <div className="max-w-3xl space-y-6">
      {back}
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Edit template</h1>
      </header>
      <TemplateForm
        // Remount if the template is refetched after saving, so the form always shows saved data.
        key={q.data.id}
        initial={q.data}
        submitLabel="Save changes"
        pendingLabel="Saving…"
        cancelHref={`/onboarding/templates/${id}`}
        pending={update.isPending}
        error={update.error}
        notice={
          <Alert>
            <AlertDescription>
              Changes apply to checklists assigned <strong>from now on</strong>. Checklists already assigned keep the tasks they were created with.
            </AlertDescription>
          </Alert>
        }
        onSubmit={(body) => update.mutate(body, { onSuccess: () => router.push(`/onboarding/templates/${id}`) })}
      />
    </div>
  );
}
