"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiClientError } from "@/lib/api";
import { useTemplates } from "@/lib/hooks/onboarding";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function TemplatesPage() {
  const q = useTemplates();
  const forbidden = q.error instanceof ApiClientError && q.error.status === 403;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Onboarding templates</h1>
          <p className="text-sm text-muted-foreground">Reusable checklists. Changing a template doesn&apos;t affect onboardings already under way.</p>
        </div>
        <Button render={<Link href="/onboarding/templates/new" />} nativeButton={false}>
          <Plus className="size-4" /> New template
        </Button>
      </header>

      {forbidden ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>You don&apos;t have access to this page.</AlertDescription>
        </Alert>
      ) : q.isError ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>Couldn&apos;t load templates.</AlertDescription>
        </Alert>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {q.isPending && [0, 1].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
          {q.data?.data.map((t) => (
            <li key={t.id}>
              <Link href={`/onboarding/templates/${t.id}`} className="block h-full">
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle role="heading" aria-level={2}>
                      {t.name}
                    </CardTitle>
                    <CardDescription>{t.taskCount} tasks</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground">{t.description || "No description."}</CardContent>
                </Card>
              </Link>
            </li>
          ))}
          {q.data && q.data.data.length === 0 && <li className="text-sm text-muted-foreground">No templates yet.</li>}
        </ul>
      )}
    </div>
  );
}
