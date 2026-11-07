import type { DisplayStatus } from "./types";

/** Deadline presets for template tasks. The offset must match the label (the API enforces this). */
export const DEADLINES = [
  { label: "Day 1", offsetDays: 0 },
  { label: "Week 1", offsetDays: 4 },
  { label: "Week 2", offsetDays: 9 },
  { label: "Day 30", offsetDays: 29 },
  { label: "Day 60", offsetDays: 59 },
  { label: "Day 90", offsetDays: 89 },
] as const;

export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  BLOCKED: "Blocked",
};
