"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SelectField } from "@/components/select-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api";
import { labelize } from "@/lib/format";
import { useCreateRequest } from "@/lib/hooks/requests";
import { useMeta } from "@/lib/hooks/users";
import type { RequestPriority } from "@/lib/types";

export default function NewRequestPage() {
  const router = useRouter();
  const meta = useMeta();
  const create = useCreateRequest();
  const [categoryId, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<RequestPriority>("MEDIUM");

  const category = meta.data?.requestCategories.find((c) => c.id === categoryId);
  const handledBy = meta.data?.departments.find((d) => d.id === category?.handlingDepartmentId)?.name;

  const apiError = create.error instanceof ApiClientError ? create.error : null;
  const fieldErrors = new Map<string, string>(
    Array.isArray(apiError?.details) ? (apiError.details as { path: string; message: string }[]).map((d) => [d.path, d.message]) : [],
  );
  const generalError = create.error && fieldErrors.size === 0 ? (apiError?.message ?? "Something went wrong. Please try again.") : null;
  const errorFor = (path: string) => (fieldErrors.has(path) ? <FieldError>{fieldErrors.get(path)}</FieldError> : null);

  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to requests
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">New request</h1>
        <p className="text-sm text-muted-foreground">Tell us what you need. It goes straight to the team that handles it.</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { categoryId, title: title.trim(), description: description.trim(), priority },
            { onSuccess: (r) => router.push(`/requests/${r.id}`) },
          );
        }}
      >
        <FieldGroup>
          {generalError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{generalError}</AlertDescription>
            </Alert>
          )}

          <Field data-invalid={fieldErrors.has("categoryId") || undefined}>
            <FieldLabel htmlFor="category">Category</FieldLabel>
            <SelectField
              id="category"
              required
              value={categoryId}
              onValueChange={setCategoryId}
              placeholder="Choose a category…"
              invalid={fieldErrors.has("categoryId")}
              options={(meta.data?.requestCategories ?? []).map((c) => ({ value: c.id, label: c.name }))}
            />
            {handledBy && <FieldDescription>Handled by {handledBy}.</FieldDescription>}
            {errorFor("categoryId")}
          </Field>

          <Field data-invalid={fieldErrors.has("title") || undefined}>
            <FieldLabel htmlFor="title">Title</FieldLabel>
            <Input id="title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-invalid={fieldErrors.has("title")} placeholder="A short summary" />
            {errorFor("title")}
          </Field>

          <Field data-invalid={fieldErrors.has("description") || undefined}>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea id="description" required maxLength={5000} rows={6} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={fieldErrors.has("description")} placeholder="What do you need, and why?" />
            {errorFor("description")}
          </Field>

          <Field>
            <FieldLabel htmlFor="priority">Priority</FieldLabel>
            <SelectField
              id="priority"
              value={priority}
              onValueChange={(v) => setPriority(v as RequestPriority)}
              options={(meta.data?.enums.requestPriorities ?? ["LOW", "MEDIUM", "HIGH", "URGENT"]).map((p) => ({ value: p, label: labelize(p) }))}
            />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={create.isPending || !categoryId || !title.trim() || !description.trim()}>
              {create.isPending ? "Submitting…" : "Submit request"}
            </Button>
            <Button type="button" variant="ghost" render={<Link href="/requests" />} nativeButton={false}>
              Cancel
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
