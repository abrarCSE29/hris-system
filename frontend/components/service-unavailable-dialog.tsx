"use client";

import { Dialog } from "@base-ui/react/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { ServerCrashIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useServiceUnavailable } from "@/lib/service-status";

/** A window that appears when the backend can't be reached, and closes itself once it can. */
export function ServiceUnavailableDialog() {
  const unavailable = useServiceUnavailable();
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);

  async function retry() {
    setChecking(true);
    try {
      await api("/health"); // a good answer clears the window; a bad one keeps it open
      await client.invalidateQueries();
    } catch {
      // still down
    } finally {
      setChecking(false);
    }
  }

  return (
    <Dialog.Root open={unavailable} modal>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[60] bg-black/40 supports-backdrop-filter:backdrop-blur-xs" />
        <Dialog.Popup
          role="alertdialog"
          className="fixed top-1/2 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-4 rounded-xl bg-popover p-6 text-center text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        >
          <ServerCrashIcon className="size-10 text-destructive" aria-hidden />
          <div className="flex flex-col gap-1">
            <Dialog.Title className="text-lg font-semibold">Service Unavailable</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">Please try again later.</Dialog.Description>
          </div>
          <Button onClick={retry} disabled={checking}>
            {checking ? "Checking…" : "Try again"}
          </Button>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
