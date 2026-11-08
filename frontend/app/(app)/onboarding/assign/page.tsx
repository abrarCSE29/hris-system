"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmployeePicker } from "@/components/people/employee-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SelectField } from "@/components/select-field";
import { useAssignChecklist, useTemplates } from "@/lib/hooks/onboarding";
import type { User } from "@/lib/types";

export default function AssignChecklistPage() {
  const router = useRouter();
  const templates = useTemplates();
  const assign = useAssignChecklist();
  const [employee, setEmployee] = useState<User | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState("");

  return (
    <div className="max-w-xl space-y-6">
      <Link href="/onboarding" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to onboarding
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Assign checklist</h1>
        <p className="text-sm text-muted-foreground">Give an existing employee an onboarding checklist. Deadlines count from the start date.</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!employee) return;
          assign.mutate(
            { employeeId: employee.id, templateId, ...(startDate && { startDate }) },
            { onSuccess: (inst) => router.push(`/onboarding/instances/${inst.id}`) },
          );
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel>Employee</FieldLabel>
            <EmployeePicker selected={employee} onSelect={setEmployee} />
          </Field>

          <Field>
            <FieldLabel htmlFor="template">Template</FieldLabel>
            <SelectField
              id="template"
              required
              value={templateId}
              onValueChange={setTemplateId}
              placeholder="Choose a template…"
              options={(templates.data?.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.taskCount} tasks)` }))}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="start">Start date (optional)</FieldLabel>
            <Input id="start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <FieldDescription>Defaults to the employee&apos;s joining date. Tasks already past due will show as overdue.</FieldDescription>
          </Field>

          <div className="flex gap-2">
            <Button type="submit" disabled={!employee || !templateId || assign.isPending}>
              {assign.isPending ? "Assigning…" : "Assign checklist"}
            </Button>
            <Button type="button" variant="ghost" render={<Link href="/onboarding" />} nativeButton={false}>
              Cancel
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
