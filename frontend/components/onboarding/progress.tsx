"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import type { Progress as ProgressSummary } from "@/lib/types";

/**
 * The shadcn Progress. Its fill is black rather than the theme's primary (red), because red is reserved for things
 * that need attention. With `animateOnMount` it grows from empty when it first appears (used on the dashboard);
 * later changes always ease to the new value, and motion is skipped for people who prefer reduced motion.
 */
export function ProgressBar({ percent, label, animateOnMount = false }: { percent: number; label: string; animateOnMount?: boolean }) {
  const [shown, setShown] = useState(animateOnMount ? 0 : percent);
  useEffect(() => {
    // Wait a frame so the browser paints the empty bar first; otherwise there is nothing to animate from.
    const id = requestAnimationFrame(() => setShown(percent));
    return () => cancelAnimationFrame(id);
  }, [percent]);

  return (
    <Progress
      value={shown}
      aria-label={label}
      className="[&_[data-slot=progress-indicator]]:bg-foreground [&_[data-slot=progress-indicator]]:duration-1000 [&_[data-slot=progress-indicator]]:ease-out motion-reduce:[&_[data-slot=progress-indicator]]:transition-none [&_[data-slot=progress-track]]:h-2"
    />
  );
}

/** "3 of 10 done · 2 blocked · 1 overdue": only mentions the counts that are non-zero. */
export function progressSentence(p: ProgressSummary): string {
  const parts = [`${p.completed} of ${p.total} done`];
  if (p.inProgress) parts.push(`${p.inProgress} in progress`);
  if (p.blocked) parts.push(`${p.blocked} blocked`);
  if (p.overdue) parts.push(`${p.overdue} overdue`);
  return parts.join(" · ");
}
