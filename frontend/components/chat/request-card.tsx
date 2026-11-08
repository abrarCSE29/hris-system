"use client";

import { SelectField } from "@/components/select-field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { labelize } from "@/lib/format";
import type { Meta, RequestPriority } from "@/lib/types";

export type DraftField = "title" | "description" | "categoryId" | "priority" | "departmentId";

export interface DraftValues {
  title: string;
  description: string;
  categoryId: string;
  priority: RequestPriority;
  departmentId: string;
}

interface Props {
  meta: Meta | undefined;
  values: DraftValues;
  /** Fields the employee has changed by hand; the others still carry the "AI suggested" badge. */
  edited: DraftField[];
  lowConfidence: boolean;
  reasoning: string;
  submitting: boolean;
  /** Field-level problems from the server, by field name. */
  errors: Map<string, string>;
  onChange: (field: DraftField, value: string) => void;
  onSubmit: () => void;
  onStartOver: () => void;
}

/** The request form, filled in by the assistant. Every field is editable and nothing is sent until Submit. */
export function RequestCard({ meta, values, edited, lowConfidence, reasoning, submitting, errors, onChange, onSubmit, onStartOver }: Props) {
  const suggested = (field: DraftField) => !edited.includes(field) && <Badge variant="secondary">AI suggested</Badge>;
  const error = (path: string) => (errors.has(path) ? <FieldError>{errors.get(path)}</FieldError> : null);
  const ready = values.title.trim() && values.description.trim() && values.categoryId && values.departmentId;

  return (
    <form
      aria-label="Draft request"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      {lowConfidence && (
        <Alert role="status">
          <AlertDescription>I&apos;m not sure about this, please check it.</AlertDescription>
        </Alert>
      )}

      <FieldGroup>
        <Field data-invalid={errors.has("title") || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="draft-title">Title</FieldLabel>
            {suggested("title")}
          </div>
          <Input id="draft-title" maxLength={200} value={values.title} onChange={(e) => onChange("title", e.target.value)} aria-invalid={errors.has("title")} />
          {error("title")}
        </Field>

        <Field data-invalid={errors.has("description") || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="draft-description">Description</FieldLabel>
            {suggested("description")}
          </div>
          <Textarea id="draft-description" rows={5} maxLength={5000} value={values.description} onChange={(e) => onChange("description", e.target.value)} aria-invalid={errors.has("description")} />
          {error("description")}
        </Field>

        <Field data-invalid={errors.has("categoryId") || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="draft-category">Category</FieldLabel>
            {suggested("categoryId")}
          </div>
          <SelectField
            id="draft-category"
            value={values.categoryId}
            onValueChange={(v) => onChange("categoryId", v)}
            invalid={errors.has("categoryId")}
            options={(meta?.requestCategories ?? []).map((c) => ({ value: c.id, label: c.name }))}
          />
          {error("categoryId")}
        </Field>

        <Field>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="draft-priority">Priority</FieldLabel>
            {suggested("priority")}
          </div>
          <SelectField
            id="draft-priority"
            value={values.priority}
            onValueChange={(v) => onChange("priority", v)}
            options={(meta?.enums.requestPriorities ?? ["LOW", "MEDIUM", "HIGH", "URGENT"]).map((p) => ({ value: p, label: labelize(p) }))}
          />
        </Field>

        <Field data-invalid={errors.has("handlingDepartmentId") || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="draft-department">Department</FieldLabel>
            {suggested("departmentId")}
          </div>
          <SelectField
            id="draft-department"
            value={values.departmentId}
            onValueChange={(v) => onChange("departmentId", v)}
            invalid={errors.has("handlingDepartmentId")}
            options={(meta?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
          />
          {error("handlingDepartmentId")}
        </Field>
      </FieldGroup>

      {reasoning && <p className="text-xs text-muted-foreground">{reasoning}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || !ready}>
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
        <Button type="button" variant="ghost" onClick={onStartOver} disabled={submitting}>
          Start over
        </Button>
      </div>
    </form>
  );
}
