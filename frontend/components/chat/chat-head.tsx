"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { RequestCard, type DraftField, type DraftValues } from "@/components/chat/request-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api";
import { useChatDraft } from "@/lib/hooks/chat";
import { useCreateRequest } from "@/lib/hooks/requests";
import { useMeta } from "@/lib/hooks/users";
import type { ChatDraft } from "@/lib/types";

const MAX = 1000;

interface Session {
  message: string;
  sent: string | null;
  draft: ChatDraft | null;
  values: DraftValues | null;
  edited: DraftField[];
  submitted: { id: string; reference: string; department: string } | null;
}
const EMPTY: Session = { message: "", sent: null, draft: null, values: null, edited: [], submitted: null };

/**
 * A floating button that opens the request assistant: one message in, one editable form card out. The card is the
 * request form with every field filled in by the AI; nothing is sent until the employee presses Submit.
 * The conversation lives in this component, so it survives closing the panel and is gone when the tab closes.
 */
export function ChatHead({ firstName }: { firstName: string }) {
  const pathname = usePathname();
  const meta = useMeta();
  const draftMutation = useChatDraft();
  const create = useCreateRequest();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<Session>(EMPTY);

  // "Waking up the assistant…" if the answer takes more than 3 seconds (a hosted AI service can be asleep).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!draftMutation.isPending) {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(id);
  }, [draftMutation.isPending]);

  const send = () => {
    const message = s.message.trim();
    if (!message || draftMutation.isPending) return;
    draftMutation.mutate(
      { message, page: pathname },
      {
        onSuccess: (draft) =>
          setS((cur) => ({
            ...cur,
            sent: message,
            draft,
            edited: [],
            values: { title: draft.title, description: draft.description, categoryId: draft.categoryId, priority: draft.priority, departmentId: draft.departmentId },
          })),
      },
    );
  };

  const change = (field: DraftField, value: string) =>
    setS((cur) => {
      if (!cur.values) return cur;
      const next = { ...cur.values, [field]: value } as DraftValues;
      let edited = cur.edited.includes(field) ? cur.edited : [...cur.edited, field];
      if (field === "categoryId") {
        // The category decides the default department; the employee can still choose another one afterwards.
        const category = meta.data?.requestCategories.find((c) => c.id === value);
        if (category) next.departmentId = category.handlingDepartmentId;
        if (!edited.includes("departmentId")) edited = [...edited, "departmentId"];
      }
      return { ...cur, values: next, edited };
    });

  const submit = () => {
    if (!s.values) return;
    const v = s.values;
    create.mutate(
      { categoryId: v.categoryId, title: v.title.trim(), description: v.description.trim(), priority: v.priority, handlingDepartmentId: v.departmentId },
      {
        onSuccess: (r) =>
          setS((cur) => ({ ...cur, submitted: { id: r.id, reference: r.reference, department: r.handlingDepartment.name } })),
      },
    );
  };

  const startOver = () => {
    draftMutation.reset();
    create.reset();
    setS(EMPTY);
  };

  const apiError = create.error instanceof ApiClientError ? create.error : null;
  const fieldErrors = new Map<string, string>(
    Array.isArray(apiError?.details) ? (apiError.details as { path: string; message: string }[]).map((d) => [d.path, d.message]) : [],
  );
  const unavailable = draftMutation.isError;

  return (
    <>
      <Button
        type="button"
        size="icon"
        aria-label="Ask the request assistant"
        className="fixed right-4 bottom-4 z-40 size-12 rounded-full shadow-lg"
        onClick={() => setOpen(true)}
      >
        <MessageSquare className="size-5" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Request assistant</SheetTitle>
            <SheetDescription>Describe what you need and I&apos;ll fill in the request for you to check.</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
            {s.submitted ? (
              <div className="space-y-3" role="status">
                <p className="text-sm">
                  Done. <span className="font-medium">{s.submitted.reference}</span> was sent to {s.submitted.department}.
                </p>
                <div className="flex gap-2">
                  <Link href={`/requests/${s.submitted.id}`} className={buttonVariants()} onClick={() => setOpen(false)}>
                    View request
                  </Link>
                  <Button variant="ghost" onClick={startOver}>
                    Raise another
                  </Button>
                </div>
              </div>
            ) : s.values && s.draft ? (
              <>
                <blockquote className="rounded-md border-l-2 bg-muted px-3 py-2 text-sm text-muted-foreground">{s.sent}</blockquote>
                <RequestCard
                  meta={meta.data}
                  values={s.values}
                  edited={s.edited}
                  lowConfidence={s.draft.lowConfidence}
                  reasoning={s.draft.reasoning}
                  submitting={create.isPending}
                  errors={fieldErrors}
                  onChange={change}
                  onSubmit={submit}
                  onStartOver={startOver}
                />
              </>
            ) : (
              <>
                <p className="text-sm">
                  Hi {firstName}, tell me what you need, for example &ldquo;my laptop won&apos;t charge&rdquo; or &ldquo;I need access to Figma&rdquo;.
                </p>
                <Field>
                  <FieldLabel htmlFor="chat-message">Your message</FieldLabel>
                  <Textarea
                    id="chat-message"
                    rows={5}
                    maxLength={MAX}
                    value={s.message}
                    onChange={(e) => setS((cur) => ({ ...cur, message: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                    }}
                    disabled={draftMutation.isPending}
                  />
                  <p className="text-right text-xs text-muted-foreground" aria-live="off">
                    {s.message.length}/{MAX}
                  </p>
                </Field>
                <Button onClick={send} disabled={!s.message.trim() || draftMutation.isPending}>
                  {draftMutation.isPending ? "Drafting…" : "Draft my request"}
                </Button>
                <p role="status" className="min-h-5 text-sm text-muted-foreground">
                  {draftMutation.isPending && slow ? "Waking up the assistant…" : ""}
                </p>
                <p className={unavailable ? "text-sm" : "text-xs text-muted-foreground"}>
                  {unavailable ? "The assistant isn't available right now. " : "Prefer the form? "}
                  <Link href="/requests/new" className="underline underline-offset-4" onClick={() => setOpen(false)}>
                    Fill it in yourself
                  </Link>
                  .
                </p>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
