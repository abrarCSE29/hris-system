"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { SelectField } from "@/components/select-field";
import { Textarea } from "@/components/ui/textarea";
import { useTransition } from "@/lib/hooks/requests";
import { useAssignable } from "@/lib/hooks/users";
import type { RequestAction, RequestDetail } from "@/lib/types";

/**
 * Shows only the actions the server says this person may take (allowedActions).
 * The server re-checks everything, so a stale screen can only ever produce an error message.
 */
export function RequestActions({ request }: { request: RequestDetail }) {
  const transition = useTransition(request.id);
  const [open, setOpen] = useState<"assign" | "resolve" | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const actions = request.allowedActions;

  const canAssign = actions.includes("assign");
  const assignable = useAssignable(request.handlingDepartment.id, canAssign && open === "assign");

  if (actions.length === 0) return null;

  const run = (action: RequestAction, extra: { assigneeId?: string; note?: string } = {}) =>
    transition.mutate(
      { action, ...extra },
      {
        onSuccess: () => {
          setOpen(null);
          setNote("");
          setAssigneeId("");
        },
      },
    );

  // Already assigned (or in progress): this is a reassignment, not a first assignment.
  const reassign = request.status === "ASSIGNED" || request.status === "IN_PROGRESS";

  return (
    <Card aria-label="Actions">
      <CardContent className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {canAssign && (
          <Button variant={open === "assign" ? "secondary" : "default"} onClick={() => setOpen(open === "assign" ? null : "assign")}>
            {reassign ? "Reassign" : "Assign"}
          </Button>
        )}
        {actions.includes("start") && (
          <Button disabled={transition.isPending} onClick={() => run("start")}>
            Start work
          </Button>
        )}
        {actions.includes("resolve") && (
          <Button variant={open === "resolve" ? "secondary" : "default"} onClick={() => setOpen(open === "resolve" ? null : "resolve")}>
            Mark resolved
          </Button>
        )}
        {actions.includes("close") && (
          <Button disabled={transition.isPending} onClick={() => run("close")}>
            Close request
          </Button>
        )}
      </div>

      {open === "assign" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("assign", { assigneeId, note: note.trim() || undefined });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="assignee">Assign to</FieldLabel>
              <SelectField
                id="assignee"
                required
                value={assigneeId}
                onValueChange={setAssigneeId}
                placeholder={assignable.isPending ? "Loading…" : "Choose a person…"}
                options={(assignable.data?.data ?? []).filter((u) => request.status !== "IN_PROGRESS" || u.id !== request.assignee?.id).map((u) => ({ value: u.id, label: `${u.fullName} · ${u.jobTitle}` }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="assign-note">Note (optional)</FieldLabel>
              <Textarea id="assign-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button type="submit" disabled={!assigneeId || transition.isPending}>
              {transition.isPending ? "Saving…" : reassign ? "Reassign request" : "Assign request"}
            </Button>
          </FieldGroup>
        </form>
      )}

      {open === "resolve" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run("resolve", { note: note.trim() || undefined });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="resolve-note">Resolution note (optional)</FieldLabel>
              <Textarea id="resolve-note" rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <Button type="submit" disabled={transition.isPending}>
              {transition.isPending ? "Saving…" : "Confirm resolved"}
            </Button>
          </FieldGroup>
        </form>
      )}
      </CardContent>
    </Card>
  );
}
