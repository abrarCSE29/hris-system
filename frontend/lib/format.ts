/** "SRI_LANKA" → "Sri Lanka", "ON_PROBATION" → "On probation". */
export function labelize(value: string, { title = true }: { title?: boolean } = {}): string {
  const words = value.toLowerCase().split("_");
  return words
    .map((w, i) => (title || i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** "2026-11-02" → "2 Nov 2026". Fixed to UTC so the date never shifts with the viewer's timezone. */
export function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** ISO timestamp → "8 Nov 2026, 14:05" in the viewer's local time. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
