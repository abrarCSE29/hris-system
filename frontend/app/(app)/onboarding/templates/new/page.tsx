"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TemplateForm } from "@/components/onboarding/template-form";
import { useCreateTemplate } from "@/lib/hooks/onboarding";

export default function NewTemplatePage() {
  const router = useRouter();
  const create = useCreateTemplate();

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/onboarding/templates" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to templates
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New template</h1>
        <p className="text-sm text-muted-foreground">A task can wait for one other task. Tasks that wait can&apos;t be started until it is done.</p>
      </header>
      <TemplateForm
        submitLabel="Save template"
        pendingLabel="Saving…"
        cancelHref="/onboarding/templates"
        pending={create.isPending}
        error={create.error}
        onSubmit={(body) => create.mutate(body, { onSuccess: (t) => router.push(`/onboarding/templates/${t.id}`) })}
      />
    </div>
  );
}
