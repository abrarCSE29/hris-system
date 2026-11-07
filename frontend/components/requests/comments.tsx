"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useAddComment } from "@/lib/hooks/requests";
import type { RequestComment } from "@/lib/types";

export function Comments({ requestId, comments }: { requestId: string; comments: RequestComment[] }) {
  const add = useAddComment(requestId);
  const [body, setBody] = useState("");
  const error = add.error instanceof ApiClientError ? add.error.message : add.error ? "Couldn't post your comment." : null;

  return (
    <section aria-labelledby="comments-heading" className="space-y-4">
      <h2 id="comments-heading" className="text-lg font-semibold tracking-tight">
        Comments {comments.length > 0 && <span className="text-muted-foreground">({comments.length})</span>}
      </h2>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id}>
              <Card size="sm">
                <CardContent>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{c.author.fullName}</span>
                    <time dateTime={c.createdAt} className="text-xs text-muted-foreground">
                      {formatDateTime(c.createdAt)}
                    </time>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{c.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(body.trim(), { onSuccess: () => setBody("") });
        }}
      >
        <FieldGroup>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="comment">Add a comment</FieldLabel>
            <Textarea id="comment" rows={3} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!body.trim() || add.isPending}>
            {add.isPending ? "Posting…" : "Post comment"}
          </Button>
        </FieldGroup>
      </form>
    </section>
  );
}
