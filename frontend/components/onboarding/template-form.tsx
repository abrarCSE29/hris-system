"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api";
import type { TemplateInput } from "@/lib/hooks/onboarding";
import { useMeta } from "@/lib/hooks/users";
import { DEADLINES } from "@/lib/onboarding";
import type { TemplateDetail } from "@/lib/types";

const MANAGER = "MANAGER";
/** The Select can't hold an empty value as an item, so "Nothing" is represented by this stand-in. */
const NOTHING = "__nothing__";

interface Row {
  key: string; // stable id for dependencies and React
  title: string;
  description: string;
  owner: string; // department id or MANAGER
  deadline: string; // label
  offsetDays: number;
  dependsOnKey: string;
}

let counter = 0;
const newRow = (): Row => ({ key: `new-${++counter}`, title: "", description: "", owner: "", deadline: "Day 1", offsetDays: 0, dependsOnKey: "" });

/** Existing tasks keep their id as the key, so "waits for" links carry over when editing. */
function rowsFrom(t: TemplateDetail): Row[] {
  return t.tasks.map((k) => ({
    key: k.id,
    title: k.title,
    description: k.description,
    owner: k.ownerType === "MANAGER" ? MANAGER : (k.ownerDepartment?.id ?? ""),
    deadline: k.deadlineLabel,
    offsetDays: k.offsetDays,
    dependsOnKey: k.dependsOnId ?? "",
  }));
}

interface Props {
  /** When editing, the template to start from. */
  initial?: TemplateDetail;
  submitLabel: string;
  pendingLabel: string;
  cancelHref: string;
  pending: boolean;
  error: unknown;
  onSubmit: (body: TemplateInput) => void;
  /** Shown above the form, e.g. a note about what an edit affects. */
  notice?: React.ReactNode;
}

export function TemplateForm({ initial, submitLabel, pendingLabel, cancelHref, pending, error, onSubmit, notice }: Props) {
  const meta = useMeta();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [rows, setRows] = useState<Row[]>(() => (initial ? rowsFrom(initial) : [newRow()]));

  const update = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const remove = (key: string) =>
    setRows((rs) => rs.filter((r) => r.key !== key).map((r) => (r.dependsOnKey === key ? { ...r, dependsOnKey: "" } : r)));
  const setDeadline = (key: string, label: string, current: Row) => {
    const preset = DEADLINES.find((d) => d.label === label);
    // A custom label (from an API-created template) keeps its own offset.
    update(key, { deadline: label, offsetDays: preset ? preset.offsetDays : current.offsetDays });
  };

  const apiError = error instanceof ApiClientError ? error : null;
  const details = Array.isArray(apiError?.details) ? (apiError.details as { path: string; message: string }[]) : [];
  const rowError = (i: number) => details.filter((d) => d.path.startsWith(`tasks.${i}.`)).map((d) => d.message);
  // Failures without field details are announced as a toast; field-level ones are shown here, beside the form.
  const general = details.find((d) => !d.path.startsWith("tasks."))?.message;

  const complete = name.trim() && rows.length > 0 && rows.every((r) => r.title.trim() && r.owner);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name: name.trim(),
          description: description.trim(),
          tasks: rows.map((r) => ({
            key: r.key,
            title: r.title.trim(),
            description: r.description.trim(),
            ownerType: r.owner === MANAGER ? "MANAGER" : "DEPARTMENT",
            ...(r.owner !== MANAGER && { ownerDepartmentId: r.owner }),
            offsetDays: r.offsetDays,
            deadlineLabel: r.deadline,
            ...(r.dependsOnKey && { dependsOnKey: r.dependsOnKey }),
          })),
        });
      }}
    >
      <FieldGroup>
        {notice}
        {general && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{general}</AlertDescription>
          </Alert>
        )}

        <Field>
          <FieldLabel htmlFor="name">Template name</FieldLabel>
          <Input id="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="desc">Description (optional)</FieldLabel>
          <Textarea id="desc" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <FieldSet>
          <FieldLegend>Tasks</FieldLegend>
          {rows.map((r, i) => {
            const deadlineOptions = [
              // A custom label (from an API-created template) stays selectable.
              ...(DEADLINES.some((d) => d.label === r.deadline) ? [] : [{ value: r.deadline, label: r.deadline }]),
              ...DEADLINES.map((d) => ({ value: d.label, label: d.label })),
            ];
            return (
              <Card key={r.key} size="sm">
                <CardContent>
                  <FieldGroup>
                    <p className="text-xs font-medium text-muted-foreground">Task {i + 1}</p>
                    <Field>
                      <FieldLabel htmlFor={`title-${r.key}`}>Title</FieldLabel>
                      <Input id={`title-${r.key}`} required maxLength={200} value={r.title} onChange={(e) => update(r.key, { title: e.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`d-${r.key}`}>Description (optional)</FieldLabel>
                      <Input id={`d-${r.key}`} maxLength={2000} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor={`o-${r.key}`}>Owner</FieldLabel>
                        <SelectField
                          id={`o-${r.key}`}
                          required
                          value={r.owner}
                          onValueChange={(v) => update(r.key, { owner: v })}
                          placeholder="Choose…"
                          options={[{ value: MANAGER, label: "New joiner's manager" }, ...(meta.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`dl-${r.key}`}>Due</FieldLabel>
                        <SelectField id={`dl-${r.key}`} value={r.deadline} onValueChange={(v) => setDeadline(r.key, v, r)} options={deadlineOptions} />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor={`dep-${r.key}`}>Waits for</FieldLabel>
                        <SelectField
                          id={`dep-${r.key}`}
                          value={r.dependsOnKey === "" ? NOTHING : r.dependsOnKey}
                          onValueChange={(v) => update(r.key, { dependsOnKey: v === NOTHING ? "" : v })}
                          options={[
                            { value: NOTHING, label: "Nothing" },
                            ...rows.flatMap((o, j) => (o.key !== r.key ? [{ value: o.key, label: `${j + 1}. ${o.title.trim() || "Untitled"}` }] : [])),
                          ]}
                        />
                      </Field>
                    </div>
                    {rowError(i).map((m) => (
                      <p key={m} className="text-xs text-destructive" role="alert">
                        {m}
                      </p>
                    ))}
                    {rows.length > 1 && (
                      <div>
                        <Button type="button" variant="ghost" size="sm" onClick={() => remove(r.key)}>
                          <Trash2 className="size-4" /> Remove task
                        </Button>
                      </div>
                    )}
                  </FieldGroup>
                </CardContent>
              </Card>
            );
          })}
          <div>
            <Button type="button" variant="outline" onClick={() => setRows((rs) => [...rs, newRow()])}>
              <Plus className="size-4" /> Add task
            </Button>
          </div>
        </FieldSet>

        <div className="flex gap-2">
          <Button type="submit" disabled={!complete || pending}>
            {pending ? pendingLabel : submitLabel}
          </Button>
          <Button type="button" variant="ghost" render={<Link href={cancelHref} />} nativeButton={false}>
            Cancel
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
