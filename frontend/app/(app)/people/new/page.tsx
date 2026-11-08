"use client";

import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { ApiClientError } from "@/lib/api";
import { labelize } from "@/lib/format";
import { type NewUserInput, useCreateUser, useTemplates } from "@/lib/hooks/onboarding";
import { useMeta, useUsers } from "@/lib/hooks/users";
import type { CreatedUser } from "@/lib/types";

/** Today's date in the viewer's own timezone (not UTC, which can still be "yesterday" in Dhaka). */
/** The Select can't hold an empty value as an item, so "None" is represented by this stand-in. */
const NONE = "__none__";
const today = () => new Date().toLocaleDateString("en-CA");

export default function NewPersonPage() {
  const meta = useMeta();
  const templates = useTemplates();
  const managers = useUsers({ role: "MANAGER", pageSize: 100 });
  const create = useCreateUser();

  const [form, setForm] = useState({ fullName: "", email: "", country: "", departmentId: "", managerId: "", jobTitle: "", joiningDate: today(), status: "ON_PROBATION" as "ACTIVE" | "ON_PROBATION", templateId: "", password: "" });
  const [created, setCreated] = useState<CreatedUser | null>(null);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  // Picking a department suggests its head as the manager, unless one is already chosen.
  const onDepartment = (departmentId: string) => {
    const head = meta.data?.departments.find((d) => d.id === departmentId)?.headId ?? "";
    set({ departmentId, managerId: form.managerId || head });
  };

  const err = create.error instanceof ApiClientError ? create.error : null;
  const details = Array.isArray(err?.details) ? (err.details as { path: string; message: string }[]) : [];
  const fieldError = (p: string) => details.find((d) => d.path === p)?.message;

  const ready = form.fullName.trim() && form.email.trim() && form.country && form.departmentId && form.managerId && form.jobTitle.trim() && form.joiningDate;

  if (created) {
    return (
      <div className="max-w-xl space-y-6">
        <header className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Check className="size-6" /> {created.user.fullName} added
          </h1>
          <p className="text-sm text-muted-foreground">
            {created.user.employeeCode} · {created.user.email}
            {created.onboarding && ` · onboarding checklist with ${created.onboarding.taskCount} tasks created`}
          </p>
        </header>

        {created.temporaryPassword ? (
          <Alert>
            <AlertDescription className="space-y-2">
              <p>This one-time password is shown only now. Share it with the new joiner securely.</p>
              <code className="block rounded-md bg-muted px-3 py-2 text-sm select-all">{created.temporaryPassword}</code>
            </AlertDescription>
          </Alert>
        ) : (
          <p className="text-sm text-muted-foreground">They can sign in with the password you set.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {created.onboarding && (
            <Button render={<Link href={`/onboarding/instances/${created.onboarding.instanceId}`} />} nativeButton={false}>
              View checklist
            </Button>
          )}
          <Button variant="outline" onClick={() => { setCreated(null); create.reset(); setForm((f) => ({ ...f, fullName: "", email: "", jobTitle: "", password: "" })); }}>
            Add another
          </Button>
          <Button variant="ghost" render={<Link href="/people" />} nativeButton={false}>
            Back to people
          </Button>
        </div>
      </div>
    );
  }

  const input = (id: keyof typeof form, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field data-invalid={fieldError(id) ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={form[id]} onChange={(e) => set({ [id]: e.target.value })} aria-invalid={!!fieldError(id)} {...props} />
      {fieldError(id) && <FieldError>{fieldError(id)}</FieldError>}
    </Field>
  );

  return (
    <div className="max-w-xl space-y-6">
      <Link href="/people" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Back to people
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Add new hire</h1>
        <p className="text-sm text-muted-foreground">Creates their account and, optionally, their onboarding checklist.</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const body: NewUserInput = {
            fullName: form.fullName.trim(), email: form.email.trim(), country: form.country, departmentId: form.departmentId,
            managerId: form.managerId, jobTitle: form.jobTitle.trim(), joiningDate: form.joiningDate, status: form.status,
            ...(form.templateId && { templateId: form.templateId }),
            ...(form.password && { password: form.password }),
          };
          create.mutate(body, { onSuccess: setCreated });
        }}
      >
        <FieldGroup>
          {input("fullName", "Full name", { required: true, maxLength: 120 })}
          <div>
            {input("email", "Work email", { type: "email", required: true, autoComplete: "off" })}
            {err?.status === 409 && <FieldError className="mt-2">{err.message}</FieldError>}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="country">Country</FieldLabel>
              <SelectField id="country" required value={form.country} onValueChange={(v) => set({ country: v })} placeholder="Choose…" options={(meta.data?.enums.countries ?? []).map((c) => ({ value: c, label: labelize(c) }))} />
            </Field>
            <Field>
              <FieldLabel htmlFor="departmentId">Department</FieldLabel>
              <SelectField id="departmentId" required value={form.departmentId} onValueChange={onDepartment} placeholder="Choose…" options={(meta.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
            </Field>
          </div>

          <Field data-invalid={fieldError("managerId") ? true : undefined}>
            <FieldLabel htmlFor="managerId">Reports to</FieldLabel>
            <SelectField id="managerId" required value={form.managerId} onValueChange={(v) => set({ managerId: v })} placeholder="Choose a manager…" invalid={!!fieldError("managerId")} options={(managers.data?.data ?? []).map((m) => ({ value: m.id, label: `${m.fullName} · ${m.jobTitle}` }))} />
            {fieldError("managerId") && <FieldError>{fieldError("managerId")}</FieldError>}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            {input("jobTitle", "Job title", { required: true, maxLength: 120 })}
            {input("joiningDate", "Joining date", { type: "date", required: true })}
          </div>

          <Field>
            <FieldLabel htmlFor="status">Employment status</FieldLabel>
            <SelectField
              id="status"
              value={form.status}
              onValueChange={(v) => set({ status: v as "ACTIVE" | "ON_PROBATION" })}
              options={[{ value: "ON_PROBATION", label: "On probation" }, { value: "ACTIVE", label: "Active" }]}
            />
            <FieldDescription>New joiners usually start on probation. This does not change who counts as a new hire; that comes from the onboarding checklist.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="templateId">Onboarding checklist (optional)</FieldLabel>
            <SelectField
              id="templateId"
              value={form.templateId}
              onValueChange={(v) => set({ templateId: v === NONE ? "" : v })}
              options={[{ value: NONE, label: "None" }, ...(templates.data?.data ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.taskCount} tasks)` }))]}
              placeholder="None"
            />
            <FieldDescription>Deadlines count from the joining date.</FieldDescription>
          </Field>

          <Field data-invalid={fieldError("password") ? true : undefined}>
            <FieldLabel htmlFor="password">Password (optional)</FieldLabel>
            <PasswordInput id="password" value={form.password} onChange={(e) => set({ password: e.target.value })} autoComplete="new-password" minLength={10} aria-invalid={!!fieldError("password")} />
            <FieldDescription>Leave blank to generate a one-time password.</FieldDescription>
            {fieldError("password") && <FieldError>{fieldError("password")}</FieldError>}
          </Field>

          <Button type="submit" disabled={!ready || create.isPending}>
            {create.isPending ? "Creating…" : "Create account"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
